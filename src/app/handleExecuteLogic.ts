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
}

// Store all unique plan fingerprints and assign them a sequential id
export const planFingerprintMap: Map<string, number> = new Map();
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
  let nodeType = typeof node['Node Type'] === 'string' ? node['Node Type'] : undefined;
  let alias = typeof node['Alias'] === 'string' ? node['Alias'] : undefined;
  let relation = typeof node['Relation Name'] === 'string' ? node['Relation Name'] : undefined;
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
  planIdCounter = 1;
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
  const sqlResults: string[] = [];
  const planFingerprintByCombination: Record<string, number> = {}; // New
  // Mapping from dimension combination to plan ID
  const isSelectStatement = (stmt: string) => stmt.trim().toUpperCase().startsWith('SELECT');
  const getStatements = (sql: string) =>
    sql
      .split(';')
      .map(s => s.trim())
      .filter(Boolean);

  // Instantiate a new PGlite instance before processing queries
  const db = new PGlite();

  // Function to process parsed EXPLAIN (FORMAT JSON) result
  function handleExplainResult(parsed: unknown, combinationKey: string) {
    const fingerprint = getPlanFingerprint(parsed);
    let id: number;
    if (planFingerprintMap.has(fingerprint)) {
      id = planFingerprintMap.get(fingerprint)!;
    } else {
      id = planIdCounter++;
      planFingerprintMap.set(fingerprint, id);
    }
    if (combinationKey) {
      planFingerprintByCombination[combinationKey] = id;
    }
    window.console.log('Plan fingerprint:', fingerprint, 'ID:', id);
  }

  // Execute preparation steps if provided
  if (preparation) {
    for (const stmt of getStatements(preparation)) {
      try {
        const result = await db.query(stmt);
        preparationResults.push(`${stmt};\nResult: ${JSON.stringify(result, null, 2)}`);
      } catch (err) {
        preparationResults.push(`${stmt};\nError: ${err}`);
      }
    }
  }

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
              handleExplainResult(explainJsonStr, combinationKey);
            }
          } catch (parseErr) {
            window.console.log('Explain JSON parse error:', parseErr);
            // Ignore parse errors for now
          }
        }
        sqlResults.push(`${queryToRun};\nResult: ${JSON.stringify(result, null, 2)}`);
      } catch (err) {
        sqlResults.push(`${queryToRun};\nError: ${err}`);
      }
    }
  };

  if (dim1Active) {
    for (let i = start0; i <= end0; i += step0) {
      for (let j = start1; j <= end1; j += step1) {
        const sql = sqlQuery
          .replaceAll('%%DIMENSION0%%', i.toString())
          .replaceAll('%%DIMENSION1%%', j.toString());
        const combinationKey = `${i},${j}`;
        await processSql(sql, combinationKey);
      }
    }
  } else {
    for (let i = start0; i <= end0; i += step0) {
      const sql = sqlQuery
        .replaceAll('%%DIMENSION0%%', i.toString())
        .replaceAll('%%DIMENSION1%%', '');
      const combinationKey = `${i},0`;
      await processSql(sql, combinationKey);
    }
  }
  return { preparationResults, sqlResults, planFingerprintByCombination };
}
