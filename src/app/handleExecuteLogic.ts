import { PGlite } from "@electric-sql/pglite";

// This function generates the result SQL statements for the Query Plan Explorer.
// It handles both single and two-dimensional intervals and prefixes SELECT statements with EXPLAIN (FORMAT JSON).

// Builds the headers for a request to the local proxy server, attaching the shared
// secret (if configured) so the proxy's optional PROXY_SHARED_SECRET check passes.
// See server/index.ts and README "Security notes" for why this is CSRF/drive-by
// protection rather than real authentication.
export function getProxyHeaders(): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const proxySecret = process.env.NEXT_PUBLIC_PROXY_SHARED_SECRET;
  if (proxySecret) {
    headers["x-proxy-secret"] = proxySecret;
  }
  return headers;
}

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
  backend: "pglite" | "proxy" | "mysql";
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
  planFingerprintMap: Map<string, number>;
  planJsonById: Map<number, string>; // Maps plan ID to full plan JSON string
  planFingerprintByCombination: Map<string, number>;
}

// Holds all unique plan fingerprints (and their sequential ids) seen during one
// handleExecuteLogic() call. Created fresh per call (see createPlanFingerprintState)
// and threaded explicitly through the call stack instead of living as module state,
// so each run starts clean and the result can be handed back to the caller (React
// state in page.tsx) rather than read from a shared global.
export interface PlanFingerprintState {
  planFingerprintMap: Map<string, number>;
  planJsonById: Map<number, string>;
  planFingerprintByCombination: Map<string, number>;
  planIdCounter: { value: number };
}

export function createPlanFingerprintState(): PlanFingerprintState {
  return {
    planFingerprintMap: new Map(),
    planJsonById: new Map(),
    planFingerprintByCombination: new Map(),
    planIdCounter: { value: 1 },
  };
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
  let obj: unknown = parsed;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      // If parsing fails, return empty fingerprint (unknown format)
      return '';
    }
  }
  if (Array.isArray(obj) && obj.length > 0 && (obj[0] as PlanNode).Plan) {
    walkNode((obj[0] as PlanNode).Plan as PlanNode, acc);
  } else if (obj && typeof obj === 'object' && (obj as PlanNode).Plan) {
    // Some EXPLAIN outputs may be a single object with a Plan
    walkNode(((obj as PlanNode).Plan as PlanNode) || (obj as PlanNode), acc);
  }
  return acc.join('>');
}

export function getOrCreatePlanId(state: PlanFingerprintState, fingerprint: string, parsed: unknown): number {
  let id: number;
  if (state.planFingerprintMap.has(fingerprint)) {
    id = state.planFingerprintMap.get(fingerprint)!;
  } else {
    id = state.planIdCounter.value++;
    state.planFingerprintMap.set(fingerprint, id);
    // Store the full plan JSON string for this new fingerprint
    state.planJsonById.set(id, typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2));
  }
  return id;
}

function assignPlanIdToCombination(state: PlanFingerprintState, combinationKey: string, id: number) {
  if (combinationKey) {
    state.planFingerprintByCombination.set(combinationKey, id);
  }
}

function handleExplainResult(state: PlanFingerprintState, parsed: unknown, combinationKey: string) {
  // Ensure we operate on a parsed JSON object (EXPLAIN may be returned as a JSON string)
  let parsedObj: unknown = parsed;
  if (typeof parsedObj === 'string') {
    try {
      parsedObj = JSON.parse(parsedObj);
    } catch {
      // keep original string if parsing fails; getPlanFingerprint will handle it
    }
  }
  const fingerprint = getPlanFingerprint(parsedObj);
  const id = getOrCreatePlanId(state, fingerprint, parsedObj);
  assignPlanIdToCombination(state, combinationKey, id);
}

// --- Shared helpers ---
// Splits SQL on top-level ';' only, skipping over ';' inside single/double-quoted
// strings and '--'/'/* */' comments so it won't mis-split statements like
// "SELECT 'a;b'" or "SELECT 1; -- note: a;b".
// Note: PostgreSQL dollar-quoted strings ($$...$$ / $tag$...$tag$) are not handled —
// a semicolon inside a dollar-quoted block would incorrectly split the statement.
// This tool only ever runs simple EXPLAIN-wrapped SELECT/DDL/DML, never PL/pgSQL
// function bodies, so this is an accepted limitation rather than a bug to fix here.
export function getStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let i = 0;
  const n = sql.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') { current += next; i += 2; inBlockComment = false; continue; }
      i++;
      continue;
    }
    if (inSingleQuote) {
      current += ch;
      if (ch === "'" && next === "'") { current += next; i += 2; continue; } // escaped '' inside string
      if (ch === "'") inSingleQuote = false;
      i++;
      continue;
    }
    if (inDoubleQuote) {
      current += ch;
      if (ch === '"' && next === '"') { current += next; i += 2; continue; } // escaped "" inside identifier
      if (ch === '"') inDoubleQuote = false;
      i++;
      continue;
    }

    // Not inside any quote/comment
    if (ch === "'") { inSingleQuote = true; current += ch; i++; continue; }
    if (ch === '"') { inDoubleQuote = true; current += ch; i++; continue; }
    if (ch === '-' && next === '-') { inLineComment = true; current += ch; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; current += ch; i++; continue; }
    if (ch === ';') { statements.push(current.trim()); current = ''; i++; continue; }

    current += ch;
    i++;
  }
  if (current.trim()) statements.push(current.trim());
  return statements.filter(Boolean);
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
export function replaceDimensions(sql: string, dim0: string, dim1: string): string {
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
export async function iterateExecutions({
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
export function calculateTotalExecutions(dim1Active: boolean, start0: number, end0: number, step0: number, start1: number, end1: number, step1: number): number {
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
async function proxyProcessSql({ sql, combinationKey, state, proxyUrl, handleExplainResult, sqlResults, executeQueries, backend }: {
  sql: string,
  combinationKey: string,
  state: PlanFingerprintState,
  proxyUrl: string,
  handleExplainResult: (state: PlanFingerprintState, parsed: unknown, combinationKey: string) => void,
  sqlResults: QueryResult[],
  executeQueries: boolean, // Now required
  backend?: string,
}) {
  for (const stmt of getStatements(sql)) {
    let queryToRun = stmt;
    let isExplain = false;
    if (isSelectStatement(stmt)) {
      if (backend === 'mysql') {
        queryToRun = `EXPLAIN FORMAT=JSON ${stmt}`;
      } else {
        queryToRun = executeQueries
          ? `EXPLAIN (ANALYZE, FORMAT JSON) ${stmt}`
          : `EXPLAIN (FORMAT JSON) ${stmt}`;
      }
      isExplain = true;
    }
    try {
      const resp = await fetch(`${proxyUrl}/query`, {
        method: "POST",
        headers: getProxyHeaders(),
        body: JSON.stringify({ sql: queryToRun, backend }),
      });
      const data: { rows?: unknown[]; fields?: unknown[]; error?: string } = await resp.json();
      if (resp.ok) {
        if (isExplain) {
          try {
            if (backend === 'mysql') {
              // MySQL: EXPLAIN FORMAT=JSON returns a single row with a 'EXPLAIN' field containing JSON
              const rows = data.rows;
              const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
              const explainJsonStr = explainRow && (explainRow as Record<string, unknown>)['EXPLAIN'];
              if (explainJsonStr) {
                handleExplainResult(state, explainJsonStr, combinationKey);
              }
            } else {
              // PostgreSQL: EXPLAIN (FORMAT JSON)
              const rows = data.rows;
              const explainRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : undefined;
              const explainJsonStr = explainRow && Object.values(explainRow)[0];
              if (explainJsonStr) {
                handleExplainResult(state, explainJsonStr, combinationKey);
              }
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

// --- MySQL plan parsing ---
function handleExplainResultMySQL(state: PlanFingerprintState, parsed: unknown, combinationKey: string) {
  type MySQLTableNode = { table: { access_type?: string } };
  type MySQLNestedLoopNode = { nested_loop: MySQLPlanNode[] };
  type MySQLPlanNode = MySQLTableNode | MySQLNestedLoopNode | Record<string, unknown>;

  let planObj: unknown = parsed;
  if (typeof parsed === 'string') {
    try {
      planObj = JSON.parse(parsed);
    } catch {
      planObj = { query_block: {} };
    }
  }
  // Recursively collect join type and access_type for each table in join order
  function collectJoinAccessTypes(obj: MySQLPlanNode | undefined, acc: string[]): void {
    if (!obj) return;
    if ('nested_loop' in obj && Array.isArray((obj as MySQLNestedLoopNode).nested_loop)) {
      acc.push('nested_loop');
      (obj as MySQLNestedLoopNode).nested_loop.forEach(child => collectJoinAccessTypes(child, acc));
    } else if ('table' in obj && typeof (obj as MySQLTableNode).table === 'object') {
      const accessType = (obj as MySQLTableNode).table.access_type || '';
      acc.push(`table:${accessType}`);
    } else if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
          collectJoinAccessTypes((obj as Record<string, unknown>)[key] as MySQLPlanNode, acc);
        }
      }
    }
  }
  let queryBlock: MySQLPlanNode | undefined;
  if (
    planObj &&
    typeof planObj === 'object' &&
    'query_block' in planObj &&
    (planObj as Record<string, unknown>).query_block &&
    typeof (planObj as Record<string, unknown>).query_block === 'object'
  ) {
    queryBlock = (planObj as Record<string, unknown>).query_block as MySQLPlanNode;
  } else if (planObj && typeof planObj === 'object') {
    queryBlock = planObj as MySQLPlanNode;
  } else {
    queryBlock = undefined;
  }
  const acc: string[] = [];
  collectJoinAccessTypes(queryBlock, acc);
  const fingerprint = acc.join('>');
  const id = getOrCreatePlanId(state, fingerprint, planObj);
  assignPlanIdToCombination(state, combinationKey, id);
}

// What executeWithProxy/executeWithPGlite compute themselves; handleExecuteLogic
// adds the plan-fingerprint state (from the fresh PlanFingerprintState it creates)
// to produce the full HandleExecuteResult.
type ExecutionOutcome = Omit<HandleExecuteResult, 'planFingerprintMap' | 'planJsonById' | 'planFingerprintByCombination'>;

export async function handleExecuteLogic(params: HandleExecuteParams): Promise<HandleExecuteResult> {
  const state = createPlanFingerprintState();
  const outcome = params.backend === "proxy" || params.backend === "mysql"
    ? await executeWithProxy(params, state)
    : await executeWithPGlite(params, state);
  return {
    ...outcome,
    planFingerprintMap: state.planFingerprintMap,
    planJsonById: state.planJsonById,
    planFingerprintByCombination: state.planFingerprintByCombination,
  };
}

async function executeWithProxy(params: HandleExecuteParams, state: PlanFingerprintState): Promise<ExecutionOutcome> {
  const {
    dim1Active, start0, end0, step0, start1, end1, step1, sqlQuery, preparation, proxyUrl = "http://localhost:4000", backend
  } = params;
  let firstError: string | undefined = undefined;
  const { onProgress } = params;
  // Preparation
  let preparationResults: QueryResult[] = [];
  if (preparation) {
    const prep = await processPreparation(preparation, async (stmt) => {
      const resp = await fetch(`${proxyUrl}/query`, {
        method: "POST",
        headers: getProxyHeaders(),
        body: JSON.stringify({ sql: stmt, backend }),
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
        state,
        proxyUrl,
        handleExplainResult: backend === 'mysql' ? handleExplainResultMySQL : handleExplainResult,
        sqlResults,
        executeQueries: params.executeQueries,
        backend,
      });
    },
    onProgress: onProgress ? (current) => onProgress(current, totalExecutions) : undefined,
  });
  return { preparationResults, sqlResults, error: firstError };
}

// --- PGlite-specific helpers ---
async function pgliteProcessSql({ db, sql, combinationKey, state, handleExplainResult, sqlResults, executeQueries }: {
  db: PGlite,
  sql: string,
  combinationKey: string,
  state: PlanFingerprintState,
  handleExplainResult: (state: PlanFingerprintState, parsed: unknown, combinationKey: string) => void,
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
            handleExplainResult(state, explainJsonStr, combinationKey);
          }
        } catch {
          // Parse failures are expected/benign here: not every statement produces
          // EXPLAIN JSON output, so silently ignoring non-JSON results is intentional.
        }
      }
      sqlResults.push({ query: queryToRun, result, combinationKey });
    } catch (err) {
      sqlResults.push({ query: queryToRun, error: err instanceof Error ? err.message : String(err), combinationKey });
    }
  }
}

async function executeWithPGlite(params: HandleExecuteParams, state: PlanFingerprintState): Promise<ExecutionOutcome> {
  const {
    dim1Active, start0, end0, step0, start1, end1, step1, sqlQuery, preparation
  } = params;
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
        state,
        handleExplainResult,
        sqlResults,
        executeQueries: params.executeQueries,
      });
    },
    onProgress: onProgress ? (current) => onProgress(current, totalExecutions) : undefined,
  });
  return { preparationResults, sqlResults, error: firstError };
}
