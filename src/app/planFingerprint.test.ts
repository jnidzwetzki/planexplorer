import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMySQLPlanFingerprint, getPlanFingerprint, handleExecuteLogic, type HandleExecuteParams } from './handleExecuteLogic';

// --- Helpers to build PostgreSQL EXPLAIN (FORMAT JSON) plans ---
type PgNode = Record<string, unknown>;

function scan(nodeType: string, relation: string, extra: PgNode = {}): PgNode {
  return { 'Node Type': nodeType, 'Relation Name': relation, Alias: relation, 'Total Cost': 10, 'Plan Rows': 100, ...extra };
}

function explain(plan: PgNode): unknown[] {
  return [{ Plan: plan, 'Planning Time': 0.1 }];
}

describe('getPlanFingerprint (PostgreSQL)', () => {
  it('ignores costs, row estimates and timings', () => {
    const a = explain({ 'Node Type': 'Hash Join', 'Total Cost': 1, Plans: [scan('Seq Scan', 't1'), { 'Node Type': 'Hash', Plans: [scan('Seq Scan', 't2')] }] });
    const b = explain({
      'Node Type': 'Hash Join', 'Total Cost': 999, 'Actual Total Time': 12.5, 'Actual Rows': 7,
      Plans: [scan('Seq Scan', 't1', { 'Plan Rows': 5 }), { 'Node Type': 'Hash', 'Peak Memory Usage': 42, Plans: [scan('Seq Scan', 't2')] }],
    });
    expect(getPlanFingerprint(a)).toBe(getPlanFingerprint(b));
    expect(getPlanFingerprint(a)).not.toBe('');
  });

  it('accepts the plan as a JSON string, an array or a single object', () => {
    const plan = explain(scan('Seq Scan', 't1'));
    const expected = getPlanFingerprint(plan);
    expect(expected).not.toBe('');
    expect(getPlanFingerprint(JSON.stringify(plan))).toBe(expected);
    expect(getPlanFingerprint(plan[0])).toBe(expected);
  });

  it('returns an empty fingerprint for unknown or malformed input instead of throwing', () => {
    expect(getPlanFingerprint('not valid json')).toBe('');
    expect(getPlanFingerprint(null)).toBe('');
    expect(getPlanFingerprint([])).toBe('');
    expect(getPlanFingerprint([null])).toBe('');
    expect(getPlanFingerprint({ foo: 'bar' })).toBe('');
  });

  it('distinguishes different node types', () => {
    expect(getPlanFingerprint(explain(scan('Seq Scan', 't1'))))
      .not.toBe(getPlanFingerprint(explain(scan('Index Scan', 't1', { 'Index Name': 't1_pkey' }))));
  });

  it('distinguishes scans on different relations', () => {
    expect(getPlanFingerprint(explain(scan('Seq Scan', 't1'))))
      .not.toBe(getPlanFingerprint(explain(scan('Seq Scan', 't2'))));
  });

  it('distinguishes index scans that use different indexes', () => {
    const a = explain(scan('Index Scan', 't1', { 'Index Name': 't1_a_idx' }));
    const b = explain(scan('Index Scan', 't1', { 'Index Name': 't1_b_idx' }));
    expect(getPlanFingerprint(a)).not.toBe(getPlanFingerprint(b));
  });

  it('distinguishes forward and backward index scans', () => {
    const a = explain(scan('Index Scan', 't1', { 'Index Name': 't1_a_idx', 'Scan Direction': 'Forward' }));
    const b = explain(scan('Index Scan', 't1', { 'Index Name': 't1_a_idx', 'Scan Direction': 'Backward' }));
    expect(getPlanFingerprint(a)).not.toBe(getPlanFingerprint(b));
  });

  it('distinguishes hashed and sorted aggregation (HashAggregate vs GroupAggregate)', () => {
    const child = scan('Index Scan', 't1', { 'Index Name': 't1_a_idx' });
    const hashed = explain({ 'Node Type': 'Aggregate', Strategy: 'Hashed', Plans: [child] });
    const sorted = explain({ 'Node Type': 'Aggregate', Strategy: 'Sorted', Plans: [child] });
    expect(getPlanFingerprint(hashed)).not.toBe(getPlanFingerprint(sorted));
  });

  it('distinguishes join types (e.g. inner vs. semi join)', () => {
    const children = [scan('Seq Scan', 't1'), { 'Node Type': 'Hash', Plans: [scan('Seq Scan', 't2')] }];
    const inner = explain({ 'Node Type': 'Hash Join', 'Join Type': 'Inner', Plans: children });
    const semi = explain({ 'Node Type': 'Hash Join', 'Join Type': 'Semi', Plans: children });
    expect(getPlanFingerprint(inner)).not.toBe(getPlanFingerprint(semi));
  });

  it('distinguishes join order (swapped build and probe side)', () => {
    const a = explain({ 'Node Type': 'Hash Join', Plans: [scan('Seq Scan', 't1'), { 'Node Type': 'Hash', Plans: [scan('Seq Scan', 't2')] }] });
    const b = explain({ 'Node Type': 'Hash Join', Plans: [scan('Seq Scan', 't2'), { 'Node Type': 'Hash', Plans: [scan('Seq Scan', 't1')] }] });
    expect(getPlanFingerprint(a)).not.toBe(getPlanFingerprint(b));
  });

  it('distinguishes the tree shape, not just the pre-order sequence of nodes', () => {
    // Append(Seq Scan a [SubPlan: Seq Scan b]) vs Append(Seq Scan a, Seq Scan b):
    // both visit the same nodes in the same order, but they are different plans.
    const nested = explain({
      'Node Type': 'Append',
      Plans: [scan('Seq Scan', 'a', { Plans: [scan('Seq Scan', 'b', { 'Parent Relationship': 'SubPlan' })] })],
    });
    const flat = explain({ 'Node Type': 'Append', Plans: [scan('Seq Scan', 'a'), scan('Seq Scan', 'b')] });
    expect(getPlanFingerprint(nested)).not.toBe(getPlanFingerprint(flat));
  });

  it('renders a readable indented tree', () => {
    const plan = explain({
      'Node Type': 'Hash Join',
      'Join Type': 'Inner',
      Plans: [
        scan('Index Scan', 'orders', { Alias: 'o', 'Index Name': 'orders_date_idx', 'Scan Direction': 'Backward' }),
        { 'Node Type': 'Hash', Plans: [scan('Seq Scan', 'customers', { Alias: 'c' })] },
      ],
    });
    expect(getPlanFingerprint(plan)).toBe([
      'Hash Join',
      '-> Index Scan Backward using orders_date_idx on orders o',
      '-> Hash',
      '   -> Seq Scan on customers c',
    ].join('\n'));
  });
});

describe('getMySQLPlanFingerprint', () => {
  it('returns an empty fingerprint for malformed input instead of throwing', () => {
    expect(getMySQLPlanFingerprint('not valid json')).toBe('');
    expect(getMySQLPlanFingerprint(null)).toBe('');
    expect(getMySQLPlanFingerprint({ query_block: { select_id: 1 } })).toBe('');
  });

  it('includes covering-index usage, union branches and materialized subqueries', () => {
    const plan = {
      query_block: {
        union_result: {
          using_temporary_table: true,
          query_specifications: [
            { query_block: { select_id: 1, table: { table_name: 't1', access_type: 'index', key: 'a_idx', using_index: true } } },
            {
              query_block: {
                select_id: 2,
                table: {
                  table_name: 'sub',
                  access_type: 'ALL',
                  materialized_from_subquery: { query_block: { table: { table_name: 't2', access_type: 'ALL' } } },
                },
              },
            },
          ],
        },
      },
    };
    expect(getMySQLPlanFingerprint(JSON.stringify(plan))).toBe([
      'union_result [temporary]',
      '-> table t1 [index using a_idx, index only]',
      '-> table sub [ALL]',
      '   -> materialized_from_subquery',
      '      -> table t2 [ALL]',
    ].join('\n'));
  });
});

// --- End-to-end through handleExecuteLogic ---
const baseParams: HandleExecuteParams = {
  dim1Active: false,
  start0: 0, end0: 0, step0: 1,
  start1: 0, end1: 0, step1: 1,
  sqlQuery: '',
  preparation: '',
  backend: 'pglite',
  executeQueries: false,
};

describe('handleExecuteLogic fingerprinting (PGlite)', () => {
  const preparation = `
    CREATE TABLE t (id int PRIMARY KEY, a int);
    INSERT INTO t SELECT g, g % 100 FROM generate_series(1, 5000) g;
    ANALYZE t;
  `;

  it('groups identical plans and separates different ones across a sweep', async () => {
    // DIMENSION0 toggles index scans: 0 -> Seq Scan, 1 -> Index Scan.
    const res = await handleExecuteLogic({
      ...baseParams,
      start0: 0, end0: 1, step0: 1,
      dim1Active: true, start1: 1, end1: 3, step1: 1,
      preparation,
      sqlQuery: 'SET enable_indexscan = %%DIMENSION0%%; SET enable_bitmapscan = %%DIMENSION0%%; SELECT * FROM t WHERE id = %%DIMENSION1%%',
    });

    expect(res.error).toBeUndefined();
    expect(res.planFingerprintMap.size).toBe(2);
    expect([...res.planFingerprintMap.values()].sort()).toEqual([1, 2]);
    expect(res.planFingerprintByCombination.size).toBe(6);

    const seqId = res.planFingerprintByCombination.get('0,1')!;
    const idxId = res.planFingerprintByCombination.get('1,1')!;
    expect(seqId).not.toBe(idxId);
    for (const j of [1, 2, 3]) {
      expect(res.planFingerprintByCombination.get(`0,${j}`)).toBe(seqId);
      expect(res.planFingerprintByCombination.get(`1,${j}`)).toBe(idxId);
    }

    const byId = new Map([...res.planFingerprintMap].map(([fp, id]) => [id, fp]));
    expect(byId.get(seqId)).toContain('Seq Scan on t');
    expect(byId.get(idxId)).toContain('Index Scan using t_pkey on t');

    // The stored full plan is the parsed EXPLAIN JSON of the first occurrence.
    for (const id of [seqId, idxId]) {
      const json = JSON.parse(res.planJsonById.get(id)!);
      expect(Array.isArray(json)).toBe(true);
      expect(json[0].Plan).toBeDefined();
    }
  }, 60_000);

  it('does not split plans on differing actual timings/rows with EXPLAIN ANALYZE', async () => {
    const res = await handleExecuteLogic({
      ...baseParams,
      start0: 0, end0: 99, step0: 33,
      preparation: `${preparation}; CREATE INDEX t_a_idx ON t (a); SET enable_seqscan = off; SET enable_bitmapscan = off;`,
      sqlQuery: 'SELECT * FROM t WHERE a = %%DIMENSION0%%',
      executeQueries: true,
    });

    expect(res.error).toBeUndefined();
    expect(res.planFingerprintByCombination.size).toBe(4);
    expect(res.planFingerprintMap.size).toBe(1);
    expect([...res.planFingerprintMap.keys()][0]).toBe('Index Scan using t_a_idx on t');
  }, 60_000);
});

describe('handleExecuteLogic fingerprinting (proxy backends)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Serves the given EXPLAIN result (keyed by the substituted dimension value
  // found in the SQL) from a stubbed fetch, shaped like server/index.ts responses.
  function stubProxy(rowFor: (sql: string) => Record<string, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      const { sql } = JSON.parse(init.body) as { sql: string };
      return { ok: true, json: async () => ({ rows: [rowFor(sql)], fields: [] }) };
    }));
  }

  it('fingerprints PostgreSQL plans returned by the proxy', async () => {
    stubProxy((sql) => ({
      'QUERY PLAN': sql.includes('= 0')
        ? explain(scan('Seq Scan', 't', { 'Total Cost': 50 }))
        : explain(scan('Index Scan', 't', { 'Index Name': 't_pkey', 'Total Cost': Math.random() })),
    }));
    const res = await handleExecuteLogic({
      ...baseParams, backend: 'proxy', start0: 0, end0: 3, step0: 1,
      sqlQuery: 'SELECT * FROM t WHERE x = %%DIMENSION0%%',
    });
    expect(res.planFingerprintMap.size).toBe(2);
    expect(res.planFingerprintByCombination.size).toBe(4);
    expect(res.planFingerprintByCombination.get('1,0')).toBe(res.planFingerprintByCombination.get('3,0'));
    expect(res.planFingerprintByCombination.get('0,0')).not.toBe(res.planFingerprintByCombination.get('1,0'));
  });

  // MySQL 8 EXPLAIN FORMAT=JSON output for
  //   SELECT ... FROM <first> JOIN <second> ... ORDER BY ...
  function mysqlJoinPlan(first: string, second: string, secondKey: string | null) {
    return {
      query_block: {
        select_id: 1,
        cost_info: { query_cost: '12.34' },
        ordering_operation: {
          using_filesort: true,
          nested_loop: [
            { table: { table_name: first, access_type: 'ALL', rows_examined_per_scan: 100, filtered: '100.00', cost_info: { read_cost: '1.00' }, used_columns: ['id', 'a'] } },
            {
              table: {
                table_name: second,
                access_type: secondKey ? 'ref' : 'ALL',
                ...(secondKey ? { possible_keys: [secondKey], key: secondKey, used_key_parts: ['a'], ref: [`db.${first}.a`] } : {}),
                rows_examined_per_scan: 1,
                filtered: '100.00',
              },
            },
          ],
        },
      },
    };
  }

  it('fingerprints MySQL plans (incl. plans wrapped in ordering/grouping operations)', async () => {
    const plans: Record<string, unknown> = {
      0: mysqlJoinPlan('t1', 't2', 't2_a_idx'),
      1: mysqlJoinPlan('t2', 't1', 't1_a_idx'), // different join order
      2: mysqlJoinPlan('t1', 't2', 't2_b_idx'), // different index
      3: mysqlJoinPlan('t1', 't2', 't2_a_idx'), // same as 0
    };
    stubProxy((sql) => ({ EXPLAIN: JSON.stringify(plans[sql.match(/x = (\d+)/)![1]]) }));

    const res = await handleExecuteLogic({
      ...baseParams, backend: 'mysql', start0: 0, end0: 3, step0: 1,
      sqlQuery: 'SELECT * FROM t1 JOIN t2 USING (a) WHERE x = %%DIMENSION0%% ORDER BY t1.id',
    });

    expect(res.planFingerprintByCombination.size).toBe(4);
    expect(res.planFingerprintMap.size).toBe(3);
    const ids = ['0,0', '1,0', '2,0', '3,0'].map((k) => res.planFingerprintByCombination.get(k));
    expect(ids[3]).toBe(ids[0]);
    expect(new Set(ids.slice(0, 3)).size).toBe(3);

    const fp = [...res.planFingerprintMap.entries()].find(([, id]) => id === ids[0])![0];
    expect(fp).toBe([
      'ordering_operation [filesort]',
      '-> nested_loop',
      '   -> table t1 [ALL]',
      '   -> table t2 [ref using t2_a_idx]',
    ].join('\n'));
  });

  it('fingerprints single-table MySQL plans', async () => {
    stubProxy((sql) => ({
      EXPLAIN: JSON.stringify({
        query_block: {
          select_id: 1,
          table: sql.includes('= 0')
            ? { table_name: 't1', access_type: 'ALL', rows_examined_per_scan: 1000 }
            : { table_name: 't1', access_type: 'range', key: 'PRIMARY', rows_examined_per_scan: 5 },
        },
      }),
    }));
    const res = await handleExecuteLogic({
      ...baseParams, backend: 'mysql', start0: 0, end0: 1, step0: 1,
      sqlQuery: 'SELECT * FROM t1 WHERE x = %%DIMENSION0%%',
    });
    expect([...res.planFingerprintMap.keys()]).toEqual(['table t1 [ALL]', 'table t1 [range using PRIMARY]']);
  });
});
