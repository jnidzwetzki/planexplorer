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
  executeQueries: boolean; // Now required
}

export interface QueryResult {
  query: string;
  result?: Record<string, unknown> | unknown[];
  error?: string;
  combinationKey?: string;
}

export interface HandleExecuteResult {
  preparationResults: QueryResult[];
  sqlResults: QueryResult[];
  error?: string; // First error encountered, if any
}

// Store all unique plan fingerprints and assign them a sequential id
export const planFingerprintMap: Map<string, number> = new Map();
export const planJsonById: Map<number, string> = new Map(); // Maps plan ID to full plan JSON string
export let planIdCounter = 1;
export let planFingerprintByCombination: Map<string, number> = new Map();

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
  planFingerprintByCombination = new Map();
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

function assignPlanIdToCombination(combinationKey: string, id: number, planFingerprintByCombination: Map<string, number>) {
  if (combinationKey) {
    planFingerprintByCombination.set(combinationKey, id);
  }
}

function handleExplainResult(parsed: unknown, combinationKey: string, planFingerprintByCombination: Map<string, number>) {
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

async function processPreparation(
  preparation: string,
  getResult: (stmt: string) => Promise<{ ok: boolean, data: unknown }>
): Promise<{ results: QueryResult[], firstError?: string }> {
  const results: QueryResult[] = [];
  let firstError: string | undefined = undefined;
  for (const stmt of getStatements(preparation)) {
    try {
      const { ok, data } = await getResult(stmt);
      if (ok) {
        results.push({ query: stmt, result: data as Record<string, unknown> | unknown[] });
      } else {
        if (!firstError) firstError = `${stmt};\nError: ${(data as { error?: string }).error}`;
        results.push({ query: stmt, error: (data as { error?: string }).error, result: data as Record<string, unknown> | unknown[] });
      }
    } catch (err) {
      if (!firstError) firstError = `${stmt};\nError: ${err instanceof Error ? err.message : String(err)}`;
      results.push({ query: stmt, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, firstError };
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
  onProgress?: (current: number) => void;
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
        if (onProgress) onProgress(executionIndex + 1);
        executionIndex++;
      }
    }
  } else {
    for (let i = start0; i <= end0 + FLOAT_TOLERANCE; i += step0) {
      const iFixed = Number(i.toFixed(8));
      const sql = replaceDimensions(sqlQuery, iFixed.toString(), '');
      const combinationKey = `${iFixed},0`;
      await callback({ sql, combinationKey, iFixed, jFixed: 0, executionIndex });
      if (onProgress) onProgress(executionIndex + 1);
      executionIndex++;
    }
  }
}

// Helper to calculate total number of executions for progress bar
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

// --- Proxy-specific helpers ---
async function proxyProcessSql({ sql, combinationKey, planFingerprintByCombination, proxyUrl, handleExplainResult, sqlResults, executeQueries }: {
  sql: string,
  combinationKey: string,
  planFingerprintByCombination: Map<string, number>,
  proxyUrl: string,
  handleExplainResult: (parsed: unknown, combinationKey: string, planFingerprintByCombination: Map<string, number>) => void,
  sqlResults: QueryResult[],
  executeQueries: boolean, // Now required
}) {
  for (const stmt of getStatements(sql)) {
    let queryToRun = stmt;
    let isExplain = false;
    if (isSelectStatement(stmt)) {
      queryToRun = executeQueries
        ? `EXPLAIN (ANALYZE, FORMAT JSON) ${stmt}`
        : `EXPLAIN (FORMAT JSON) ${stmt}`;
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
        sqlResults.push({ query: queryToRun, result: data, combinationKey });
      } else {
        sqlResults.push({ query: queryToRun, error: data.error, result: data, combinationKey });
      }
    } catch (err) {
      sqlResults.push({ query: queryToRun, error: err instanceof Error ? err.message : String(err), combinationKey });
    }
  }
}

// --- PGlite-specific helpers ---
async function pgliteProcessSql({ db, sql, combinationKey, planFingerprintByCombination, handleExplainResult, sqlResults, executeQueries }: {
  db: PGlite,
  sql: string,
  combinationKey: string,
  planFingerprintByCombination: Map<string, number>,
  handleExplainResult: (parsed: unknown, combinationKey: string, planFingerprintByCombination: Map<string, number>) => void,
  sqlResults: QueryResult[],
  executeQueries: boolean, // Now required
}) {
  for (const stmt of getStatements(sql)) {
    let queryToRun = stmt;
    let isExplain = false;
    if (isSelectStatement(stmt)) {
      queryToRun = executeQueries
        ? `EXPLAIN (ANALYZE, FORMAT JSON) ${stmt}`
        : `EXPLAIN (FORMAT JSON) ${stmt}`;
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
      sqlResults.push({ query: queryToRun, result, combinationKey });
    } catch (err) {
      sqlResults.push({ query: queryToRun, error: err instanceof Error ? err.message : String(err), combinationKey });
    }
  }
}

// --- Main functions ---
async function executeWithProxy(params: HandleExecuteParams): Promise<HandleExecuteResult> {
  const {
    dim1Active, start0, end0, step0, start1, end1, step1, sqlQuery, preparation, proxyUrl = "http://localhost:4000"
  } = params;
  // Clear planFingerprintByCombination before use
  planFingerprintByCombination.clear();
  let firstError: string | undefined = undefined;
  const { onProgress } = params;
  // Preparation
  let preparationResults: QueryResult[] = [];
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
  const sqlResults: QueryResult[] = [];
  const totalExecutions = calculateTotalExecutions(dim1Active, start0, end0, step0, start1, end1, step1);
  await iterateExecutions({
    dim1Active,
    start0,
    end0,
    step0,
    start1,
    end1,
    step1,
    sqlQuery,
    callback: async ({ sql, combinationKey }) => {
      await proxyProcessSql({
        sql,
        combinationKey,
        planFingerprintByCombination,
        proxyUrl,
        handleExplainResult,
        sqlResults,
        executeQueries: params.executeQueries,
      });
    },
    onProgress: onProgress ? (current) => onProgress(current, totalExecutions) : undefined,
  });
  return { preparationResults, sqlResults, error: firstError };
}

async function executeWithPGlite(params: HandleExecuteParams): Promise<HandleExecuteResult> {
  const {
    dim1Active, start0, end0, step0, start1, end1, step1, sqlQuery, preparation
  } = params;
  // Clear planFingerprintByCombination before use
  planFingerprintByCombination.clear();
  let firstError: string | undefined = undefined;
  const db = new PGlite();
  const { onProgress } = params;
  // Preparation
  let preparationResults: QueryResult[] = [];
  if (preparation) {
    const prep = await processPreparation(preparation, async (stmt) => {
      try {
        const result = await db.query(stmt);
        return { ok: true, data: result };
      } catch (err) {
        return { ok: false, data: { error: err instanceof Error ? err.message : String(err) } };
      }
    });
    preparationResults = prep.results;
    firstError = prep.firstError;
  }
  // Execution
  const sqlResults: QueryResult[] = [];
  const totalExecutions = calculateTotalExecutions(dim1Active, start0, end0, step0, start1, end1, step1);
  await iterateExecutions({
    dim1Active,
    start0,
    end0,
    step0,
    start1,
    end1,
    step1,
    sqlQuery,
    callback: async ({ sql, combinationKey }) => {
      await pgliteProcessSql({
        db,
        sql,
        combinationKey,
        planFingerprintByCombination,
        handleExplainResult,
        sqlResults,
        executeQueries: params.executeQueries,
      });
    },
    onProgress: onProgress ? (current) => onProgress(current, totalExecutions) : undefined,
  });
  return { preparationResults, sqlResults, error: firstError };
}

export async function handleExecuteLogic(params: HandleExecuteParams): Promise<HandleExecuteResult> {
  if (params.backend === "proxy") {
    return executeWithProxy(params);
  } else {
    return executeWithPGlite(params);
  }
}
