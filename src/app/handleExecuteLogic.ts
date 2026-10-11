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

// A plan fingerprint is an indented tree of node labels, one line per node:
//
//   Hash Join
//   -> Seq Scan on orders o
//   -> Hash
//      -> Index Scan using customers_pkey on customers c
//
// It captures everything that makes two plans "different" (node types, join
// order/tree shape, relations, indexes, join/aggregate strategies) and ignores
// everything that varies between executions of the same plan (costs, row
// estimates, timings). The indentation keeps the tree shape unambiguous, which
// a flat pre-order list of nodes would not be.

interface PlanNode {
  [key: string]: unknown;
  'Node Type'?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(node: Record<string, unknown>, key: string): string | undefined {
  return typeof node[key] === 'string' ? (node[key] as string) : undefined;
}

function indentLine(depth: number, label: string): string {
  return depth === 0 ? label : `${'   '.repeat(depth - 1)}-> ${label}`;
}

// Label for one PostgreSQL plan node, modeled on text EXPLAIN output
// (e.g. "Index Scan Backward using t_a_idx on t x").
function describePgNode(node: PlanNode): string {
  const parts = [stringField(node, 'Node Type') ?? '?'];
  const joinType = stringField(node, 'Join Type');
  if (joinType && joinType !== 'Inner') parts.push(`(${joinType})`);
  const strategy = stringField(node, 'Strategy'); // Aggregate/SetOp: Plain, Sorted, Hashed, Mixed
  if (strategy && strategy !== 'Plain') parts.push(`(${strategy})`);
  if (stringField(node, 'Scan Direction') === 'Backward') parts.push('Backward');
  const indexName = stringField(node, 'Index Name');
  if (indexName) parts.push(`using ${indexName}`);
  const alias = stringField(node, 'Alias');
  const target = stringField(node, 'Relation Name') ?? stringField(node, 'CTE Name') ?? stringField(node, 'Function Name');
  if (target) {
    parts.push(`on ${target}${alias && alias !== target ? ` ${alias}` : ''}`);
  } else if (alias) {
    parts.push(`on ${alias}`);
  }
  const relationship = stringField(node, 'Parent Relationship');
  const prefix = relationship === 'InitPlan' || relationship === 'SubPlan' ? `${relationship}: ` : '';
  return prefix + parts.join(' ');
}

function walkPgNode(node: PlanNode, depth: number, lines: string[]): void {
  lines.push(indentLine(depth, describePgNode(node)));
  const children = Array.isArray(node.Plans) ? node.Plans : [];
  for (const child of children) {
    if (isObject(child)) walkPgNode(child as PlanNode, depth + 1, lines);
  }
}

export function getPlanFingerprint(parsed: unknown): string {
  let obj: unknown = parsed;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      // If parsing fails, return empty fingerprint (unknown format)
      return '';
    }
  }
  // EXPLAIN (FORMAT JSON) returns [{ Plan: {...} }]; also accept a bare { Plan: {...} }
  const root = Array.isArray(obj) ? obj[0] : obj;
  if (!isObject(root) || !isObject(root.Plan)) return '';
  const lines: string[] = [];
  walkPgNode(root.Plan as PlanNode, 0, lines);
  return lines.join('\n');
}

// MySQL EXPLAIN FORMAT=JSON keys that represent a plan operation and get their
// own line in the fingerprint. Other nested objects/arrays (query_block,
// query_specifications, attached_subqueries, ...) are walked transparently.
const MYSQL_OPERATIONS = new Set([
  'nested_loop',
  'ordering_operation',
  'grouping_operation',
  'duplicates_removal',
  'windowing',
  'union_result',
  'materialized_from_subquery',
]);

function describeMySQLNode(key: string, value: unknown): string {
  const node = isObject(value) ? value : {};
  const details: string[] = [];
  if (key === 'table') {
    const accessType = stringField(node, 'access_type');
    const indexName = stringField(node, 'key');
    if (accessType) details.push(indexName ? `${accessType} using ${indexName}` : accessType);
    if (node.using_index === true) details.push('index only');
    const label = `table ${stringField(node, 'table_name') ?? '?'}`;
    return details.length ? `${label} [${details.join(', ')}]` : label;
  }
  if (node.using_temporary_table === true) details.push('temporary');
  if (node.using_filesort === true) details.push('filesort');
  return details.length ? `${key} [${details.join(', ')}]` : key;
}

function walkMySQLValue(value: unknown, depth: number, lines: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walkMySQLValue(item, depth, lines));
    return;
  }
  if (!isObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== 'object' || child === null) continue;
    if (key === 'table' || MYSQL_OPERATIONS.has(key)) {
      lines.push(indentLine(depth, describeMySQLNode(key, child)));
      walkMySQLValue(child, depth + 1, lines);
    } else {
      walkMySQLValue(child, depth, lines);
    }
  }
}

// Fingerprint for MySQL EXPLAIN FORMAT=JSON output (same tree format as getPlanFingerprint).
export function getMySQLPlanFingerprint(parsed: unknown): string {
  let obj: unknown = parsed;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      return '';
    }
  }
  if (!isObject(obj)) return '';
  const lines: string[] = [];
  walkMySQLValue(isObject(obj.query_block) ? obj.query_block : obj, 0, lines);
  return lines.join('\n');
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

// Matches plain SELECTs and CTEs (WITH ... SELECT ...), which also produce a
// result set and should be EXPLAIN-wrapped like a SELECT.
export function isSelectStatement(stmt: string): boolean {
  const upper = stmt.trim().toUpperCase();
  return upper.startsWith('SELECT') || upper.startsWith('WITH');
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
  let planObj: unknown = parsed;
  if (typeof parsed === 'string') {
    try {
      planObj = JSON.parse(parsed);
    } catch {
      // keep original string; getMySQLPlanFingerprint returns '' for it
    }
  }
  const fingerprint = getMySQLPlanFingerprint(planObj);
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
