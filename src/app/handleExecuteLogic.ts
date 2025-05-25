import { PGlite } from "@electric-sql/pglite";

// This function generates the result SQL statements for the Query Plan Explorer.
// It handles both single and two-dimensional intervals and prefixes SELECT statements with EXPLAIN (FORMAT JSON).

export interface HandleExecuteParams {
  dim1Active: boolean;
  start0: number;
  end0: number;
  step0: number;
  start1: number;
  end1: number;
  step1: number;
  sqlQuery: string;
  preparation: string;
  backend: "pglite" | "proxy";
  proxyUrl?: string;
  onProgress?: (current: number, total: number) => void; // Optional progress callback
}

export interface HandleExecuteResult {
  preparationResults: string[];
  sqlResults: string[];
  planFingerprintByCombination: Record<string, number>; // New: maps dimension combination to plan ID
  error?: string; // First error encountered, if any
  sampled?: boolean; // Indicates if results are sampled
  sampleCount?: number; // Number of samples in sqlResults
  totalExecutions?: number; // Total number of executions
}

// Store all unique plan fingerprints and assign them a sequential id
export const planFingerprintMap: Map<string, number> = new Map();
export const planJsonById: Map<number, string> = new Map(); // Maps plan ID to full plan JSON string
export let planIdCounter = 1;

// Specify types instead of any for walkNode and getPlanFingerprint
interface PlanNode {
  [key: string]: unknown;
  'Node Type'?: string;
}

function walkNode(node: PlanNode, acc: string[]): void {
  if (!node || typeof node !== 'object') return;
  const nodeType = typeof node['Node Type'] === 'string' ? node['Node Type'] : undefined;
  const alias = typeof node['Alias'] === 'string' ? node['Alias'] : undefined;
  const relation = typeof node['Relation Name'] === 'string' ? node['Relation Name'] : undefined;
  if (nodeType) {
    let label = nodeType;
    if (alias || relation) {
      label += '(';
      if (alias) {
        label += alias;
      } else if (relation) {
        label += relation;
      }
      label += ')';
    }
    acc.push(label);
  }
  for (const key in node) {
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((child) => walkNode(child as PlanNode, acc));
    } else if (typeof value === 'object' && value !== null) {
      walkNode(value as PlanNode, acc);
    }
  }
}

export function getPlanFingerprint(parsed: unknown): string {
  const acc: string[] = [];
  if (Array.isArray(parsed) && parsed.length > 0 && (parsed[0] as PlanNode).Plan) {
    walkNode((parsed[0] as PlanNode).Plan as PlanNode, acc);
  }
  return acc.join('>');
}

export function resetPlanIdCounter() {
  planIdCounter = 1;
}

export function clearPlanFingerprints() {
  planFingerprintMap.clear();
  planJsonById.clear();
  planIdCounter = 1;
}

function getOrCreatePlanId(fingerprint: string, parsed: unknown): number {
  let id: number;
  if (planFingerprintMap.has(fingerprint)) {
    id = planFingerprintMap.get(fingerprint)!;
  } else {
    id = planIdCounter++;
    planFingerprintMap.set(fingerprint, id);
    // Store the full plan JSON string for this new fingerprint
    planJsonById.set(id, typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
  }
  return id;
}

function assignPlanIdToCombination(combinationKey: string, id: number, planFingerprintByCombination: Record<string, number>) {
  if (combinationKey) {
    planFingerprintByCombination[combinationKey] = id;
  }
}

function handleExplainResult(parsed: unknown, combinationKey: string, planFingerprintByCombination: Record<string, number>) {
  const fingerprint = getPlanFingerprint(parsed);
  const id = getOrCreatePlanId(fingerprint, parsed);
  assignPlanIdToCombination(combinationKey, id, planFingerprintByCombination);
}

// --- Shared helpers ---
function getStatements(sql: string): string[] {
  return sql.split(';').map(s => s.trim()).filter(Boolean);
}

function isSelectStatement(stmt: string): boolean {
  return stmt.trim().toUpperCase().startsWith('SELECT');
}

const FLOAT_TOLERANCE = 1e-8; // Used to avoid floating point errors in loop conditions
const SAMPLE_SIZE = 100; // Used for sampling in getSampleIndices

function getSampleIndices(totalExecutions: number): { sampleIndices?: Set<number>, sampled: boolean, sampleCount: number } {
  if (totalExecutions > SAMPLE_SIZE) {
    const sampleIndices = new Set<number>();
    for (let k = 0; k < SAMPLE_SIZE; k++) {
      sampleIndices.add(Math.floor(k * totalExecutions / SAMPLE_SIZE));
    }
    return { sampleIndices, sampled: true, sampleCount: SAMPLE_SIZE };
  } else {
    return { sampleIndices: undefined, sampled: false, sampleCount: totalExecutions };
  }
}

async function processPreparation(
  preparation: string,
  getResult: (stmt: string) => Promise<{ ok: boolean, data: unknown }>
): Promise<{ results: string[], firstError?: string }> {
  const results: string[] = [];
  let firstError: string | undefined = undefined;
  for (const stmt of getStatements(preparation)) {
    try {
      const { ok, data } = await getResult(stmt);
      if (ok) {
        results.push(`${stmt};\nResult: ${JSON.stringify(data, null, 2)}`);
      } else {
        if (!firstError) firstError = `${stmt};\nError: ${(data as { error?: string }).error}`;
        results.push(`${stmt};\nError: ${(data as { error?: string }).error}`);
      }
    } catch (err) {
      if (!firstError) firstError = `${stmt};\nError: ${err instanceof Error ? err.message : String(err)}`;
      results.push(`${stmt};\nError: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { results, firstError };
}

// Helper to calculate total number of executions for progress bar and sampling
function calculateTotalExecutions(dim1Active: boolean, start0: number, end0: number, step0: number, start1: number, end1: number, step1: number): number {
  let total = 0;
  if (dim1Active) {
    for (let i = start0; i <= end0 + FLOAT_TOLERANCE; i += step0) {
      for (let j = start1; j <= end1 + FLOAT_TOLERANCE; j += step1) {
        total++;
      }
    }
  } else {
    for (let i = start0; i <= end0 + FLOAT_TOLERANCE; i += step0) {
      total++;
    }
  }
  return total;
}

// Helper to replace dimension placeholders in SQL
function replaceDimensions(sql: string, dim0: string, dim1: string): string {
  // Replaces %%DIMENSION0%% and %%DIMENSION1%% in the SQL string
  return sql
    .replaceAll('%%DIMENSION0%%', dim0)
    .replaceAll('%%DIMENSION1%%', dim1);
}

// Interface for execution callback arguments
interface ExecutionCallbackArgs {
  sql: string;
  combinationKey: string;
  iFixed: number;
  jFixed: number;
  executionIndex: number;
}

// Shared helper to iterate over all executions (1D or 2D) and call a callback for each combination
async function iterateExecutions({
  dim1Active,
  start0,
  end0,
  step0,
  start1,
  end1,
  step1,
  sqlQuery,
  callback,
  onProgress,
  totalExecutions,
}: {
  dim1Active: boolean;
  start0: number;
  end0: number;
  step0: number;
  start1: number;
  end1: number;
  step1: number;
  sqlQuery: string;
  callback: (args: ExecutionCallbackArgs) => Promise<void>;
  onProgress?: (current: number, total: number) => void;
  totalExecutions: number;
}) {
  let executionIndex = 0;
  if (dim1Active) {
    for (let i = start0; i <= end0 + FLOAT_TOLERANCE; i += step0) {
      const iFixed = Number(i.toFixed(8));
      for (let j = start1; j <= end1 + FLOAT_TOLERANCE; j += step1) {
        const jFixed = Number(j.toFixed(8));
        const sql = replaceDimensions(sqlQuery, iFixed.toString(), jFixed.toString());
        const combinationKey = `${iFixed},${jFixed}`;
        await callback({ sql, combinationKey, iFixed, jFixed, executionIndex });
        if (onProgress) onProgress(executionIndex + 1, totalExecutions);
        executionIndex++;
      }
    }
  } else {
    for (let i = start0; i <= end0 + FLOAT_TOLERANCE; i += step0) {
      const iFixed = Number(i.toFixed(8));
      const sql = replaceDimensions(sqlQuery, iFixed.toString(), '');
      const combinationKey = `${iFixed},0`;
      await callback({ sql, combinationKey, iFixed, jFixed: 0, executionIndex });
      if (onProgress) onProgress(executionIndex + 1, totalExecutions);
      executionIndex++;
    }
  }
}

// --- Proxy-specific helpers ---
async function proxyProcessSql({ sql, combinationKey, sampleIndices, executionIndex, planFingerprintByCombination, proxyUrl, handleExplainResult, sqlResults }: {
  sql: string,
  combinationKey: string,
  sampleIndices?: Set<number>,
  executionIndex: number,
  planFingerprintByCombination: Record<string, number>,
  proxyUrl: string,
  handleExplainResult: (parsed: unknown, combinationKey: string, planFingerprintByCombination: Record<string, number>) => void,
  sqlResults: string[],
}) {
  for (const stmt of getStatements(sql)) {
    let queryToRun = stmt;
    let isExplain = false;
    if (isSelectStatement(stmt)) {
      queryToRun = `EXPLAIN (FORMAT JSON) ${stmt}`;
      isExplain = true;
    }
    try {
      const resp = await fetch(`${proxyUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: queryToRun }),
      });
      const data: { rows?: unknown[]; fields?: unknown[]; error?: string } = await resp.json();
      if (resp.ok) {
        if (isExplain) {
          try {
            const rows = data.rows;
            const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
            const explainJsonStr = explainRow && Object.values(explainRow)[0];
            if (explainJsonStr) {
              handleExplainResult(explainJsonStr, combinationKey, planFingerprintByCombination);
            }
          } catch {}
        }
        if (!sampleIndices || sampleIndices.has(executionIndex)) {
          sqlResults.push(`${queryToRun};\nResult: ${JSON.stringify(data, null, 2)}`);
        }
      } else {
        if (!sampleIndices || sampleIndices.has(executionIndex)) {
          sqlResults.push(`${queryToRun};\nError: ${data.error}`);
        }
      }
    } catch (err) {
      if (!sampleIndices || sampleIndices.has(executionIndex)) {
        sqlResults.push(`${queryToRun};\nError: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// --- PGlite-specific helpers ---
async function pgliteProcessSql({ db, sql, combinationKey, sampleIndices, executionIndex, planFingerprintByCombination, handleExplainResult, sqlResults }: {
  db: PGlite,
  sql: string,
  combinationKey: string,
  sampleIndices?: Set<number>,
  executionIndex: number,
  planFingerprintByCombination: Record<string, number>,
  handleExplainResult: (parsed: unknown, combinationKey: string, planFingerprintByCombination: Record<string, number>) => void,
  sqlResults: string[],
}) {
  for (const stmt of getStatements(sql)) {
    let queryToRun = stmt;
    let isExplain = false;
    if (isSelectStatement(stmt)) {
      queryToRun = `EXPLAIN (FORMAT JSON) ${stmt}`;
      isExplain = true;
    }
    try {
      const result = await db.query(queryToRun);
      if (isExplain) {
        try {
          const rows = (result as { rows: unknown[] }).rows;
          const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
          const explainJsonStr = explainRow && Object.values(explainRow)[0] as string;
          if (explainJsonStr) {
            handleExplainResult(explainJsonStr, combinationKey, planFingerprintByCombination);
          }
        } catch (parseErr) {
          window.console.log('Explain JSON parse error:', parseErr);
        }
      }
      if (!sampleIndices || sampleIndices.has(executionIndex)) {
        sqlResults.push(`${queryToRun};\nResult: ${JSON.stringify(result, null, 2)}`);
      }
    } catch (err) {
      if (!sampleIndices || sampleIndices.has(executionIndex)) {
        sqlResults.push(`${queryToRun};\nError: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}

// --- Main functions ---
async function executeWithProxy(params: HandleExecuteParams): Promise<HandleExecuteResult> {
  const {
    dim1Active, start0, end0, step0, start1, end1, step1, sqlQuery, preparation, proxyUrl = "http://localhost:4000"
  } = params;
  const planFingerprintByCombination: Record<string, number> = {};
  let firstError: string | undefined = undefined;
  const { onProgress } = params;
  // Preparation
  let preparationResults: string[] = [];
  if (preparation) {
    const prep = await processPreparation(preparation, async (stmt) => {
      const resp = await fetch(`${proxyUrl}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: stmt }),
      });
      const data = await resp.json();
      return { ok: resp.ok, data };
    });
    preparationResults = prep.results;
    firstError = prep.firstError;
  }
  // Execution
  const totalExecutions = calculateTotalExecutions(dim1Active, start0, end0, step0, start1, end1, step1);
  if (onProgress) onProgress(0, totalExecutions);
  const { sampleIndices, sampled, sampleCount } = getSampleIndices(totalExecutions);
  const sqlResults: string[] = [];
  await iterateExecutions({
    dim1Active,
    start0,
    end0,
    step0,
    start1,
    end1,
    step1,
    sqlQuery,
    callback: async ({ sql, combinationKey, executionIndex }) => {
      await proxyProcessSql({
        sql,
        combinationKey,
        sampleIndices,
        executionIndex,
        planFingerprintByCombination,
        proxyUrl,
        handleExplainResult,
        sqlResults,
      });
    },
    onProgress,
    totalExecutions,
  });
  return { preparationResults, sqlResults, planFingerprintByCombination, error: firstError, sampled, sampleCount, totalExecutions };
}

async function executeWithPGlite(params: HandleExecuteParams): Promise<HandleExecuteResult> {
  const {
    dim1Active, start0, end0, step0, start1, end1, step1, sqlQuery, preparation
  } = params;
  const preparationResults: string[] = [];
  const sqlResults: string[] = [];
  const planFingerprintByCombination: Record<string, number> = {};
  let firstError: string | undefined = undefined;
  const db = new PGlite();
  const { onProgress } = params;
  // Preparation
  if (preparation) {
    const prep = await processPreparation(preparation, async (stmt) => {
      try {
        const result = await db.query(stmt);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, data: { error: err } };
      }
    });
    preparationResults.push(...prep.results);
    firstError = prep.firstError;
  }
  // Execution
  const totalExecutions = calculateTotalExecutions(dim1Active, start0, end0, step0, start1, end1, step1);
  if (onProgress) onProgress(0, totalExecutions);
  const { sampleIndices, sampled, sampleCount } = getSampleIndices(totalExecutions);
  await iterateExecutions({
    dim1Active,
    start0,
    end0,
    step0,
    start1,
    end1,
    step1,
    sqlQuery,
    callback: async ({ sql, combinationKey, executionIndex }) => {
      await pgliteProcessSql({
        db,
        sql,
        combinationKey,
        sampleIndices,
        executionIndex,
        planFingerprintByCombination,
        handleExplainResult,
        sqlResults,
      });
    },
    onProgress,
    totalExecutions,
  });
  return { preparationResults, sqlResults, planFingerprintByCombination, error: firstError, sampled, sampleCount, totalExecutions };
}

export async function handleExecuteLogic(params: HandleExecuteParams): Promise<HandleExecuteResult> {
  if (params.backend === "proxy") {
    return executeWithProxy(params);
  } else {
    return executeWithPGlite(params);
  }
}
