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

export function getPlanCount() {
  return planFingerprintMap.size;
}

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

export async function handleExecuteLogic({
  dim1Active,
  start0,
  end0,
  step0,
  start1,
  end1,
  step1,
  sqlQuery,
  preparation,
}: HandleExecuteParams): Promise<HandleExecuteResult> {
  const preparationResults: string[] = [];
  // Only store up to 100 samples in sqlResults if more than 100 executions
  const sqlResults: string[] = [];
  const planFingerprintByCombination: Record<string, number> = {}; // New
  let firstError: string | undefined = undefined; // Track the first error
  // Mapping from dimension combination to plan ID
  const isSelectStatement = (stmt: string) => stmt.trim().toUpperCase().startsWith('SELECT');
  const getStatements = (sql: string) =>
    sql
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

  // Instantiate a new PGlite instance before processing queries
  const db = new PGlite();

  // Execute preparation steps if provided
  if (preparation) {
    for (const stmt of getStatements(preparation)) {
      try {
        const result = await db.query(stmt);
        preparationResults.push(`${stmt};\nResult: ${JSON.stringify(result, null, 2)}`);
      } catch (err) {
        if (!firstError) firstError = `${stmt};\nError: ${err}`;
        preparationResults.push(`${stmt};\nError: ${err}`);
      }
    }
  }

  // --- Sampling logic for sqlResults ---
  // Calculate total number of executions
  let totalExecutions = 0;
  if (dim1Active) {
    for (let i = start0; i <= end0 + 1e-8; i += step0) {
      for (let j = start1; j <= end1 + 1e-8; j += step1) {
        totalExecutions++;
      }
    }
  } else {
    for (let i = start0; i <= end0 + 1e-8; i += step0) {
      totalExecutions++;
    }
  }
  // If more than 100, sample indices to keep
  let sampleIndices: Set<number> | undefined = undefined;
  let sampled = false;
  let sampleCount = 0;
  if (totalExecutions > 100) {
    sampleIndices = new Set<number>();
    for (let k = 0; k < 100; k++) {
      // Evenly distributed indices
      sampleIndices.add(Math.floor(k * totalExecutions / 100));
    }
    sampled = true;
    sampleCount = 100;
  } else {
    sampleCount = totalExecutions;
  }
  let executionIndex = 0;

  // --- Modified processSql to support sampling ---
  const processSql = async (sql: string, combinationKey: string) => {
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
            // result is an object with a 'rows' array, each row has the query plan as JSON string
            const rows = (result as { rows: unknown[] }).rows;
            const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
            const explainJsonStr = explainRow && Object.values(explainRow)[0] as string;
            if (explainJsonStr) {
              handleExplainResult(explainJsonStr, combinationKey, planFingerprintByCombination);
            }
          } catch (parseErr) {
            window.console.log('Explain JSON parse error:', parseErr);
            // Ignore parse errors for now
          }
        }
        // Only add to sqlResults if not sampling, or if this execution is a sample
        if (!sampleIndices || sampleIndices.has(executionIndex)) {
          sqlResults.push(`${queryToRun};\nResult: ${JSON.stringify(result, null, 2)}`);
        }
      } catch (err) {
        if (!firstError) firstError = `${queryToRun};\nError: ${err}`;
        if (!sampleIndices || sampleIndices.has(executionIndex)) {
          sqlResults.push(`${queryToRun};\nError: ${err}`);
        }
      }
    }
    executionIndex++;
  };

  if (dim1Active) {
    for (let i = start0; i <= end0 + 1e-8; i += step0) {
      // Fix floating point precision issues (0.2, 0.4, 0.6000000000000001)
      const iFixed = Number(i.toFixed(8));
      for (let j = start1; j <= end1 + 1e-8; j += step1) {
        const jFixed = Number(j.toFixed(8));
        const sql = sqlQuery
          .replaceAll('%%DIMENSION0%%', iFixed.toString())
          .replaceAll('%%DIMENSION1%%', jFixed.toString());
        const combinationKey = `${iFixed},${jFixed}`;
        await processSql(sql, combinationKey);
      }
    }
  } else {
    for (let i = start0; i <= end0 + 1e-8; i += step0) {
      const iFixed = Number(i.toFixed(8));
      const sql = sqlQuery
        .replaceAll('%%DIMENSION0%%', iFixed.toString())
        .replaceAll('%%DIMENSION1%%', '');
      const combinationKey = `${iFixed},0`;
      await processSql(sql, combinationKey);
    }
  }
  return { preparationResults, sqlResults, planFingerprintByCombination, error: firstError, sampled, sampleCount, totalExecutions };
}
