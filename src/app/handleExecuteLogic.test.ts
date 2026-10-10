import { afterEach, describe, expect, it } from 'vitest';
import {
  getStatements,
  isSelectStatement,
  replaceDimensions,
  iterateExecutions,
  calculateTotalExecutions,
  getPlanFingerprint,
  getOrCreatePlanId,
  createPlanFingerprintState,
  getProxyHeaders,
} from './handleExecuteLogic';

describe('getStatements', () => {
  it('splits plain multi-statement SQL on top-level semicolons', () => {
    expect(getStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('does not split on a semicolon inside a single-quoted string', () => {
    expect(getStatements("SELECT 'a;b';")).toEqual(["SELECT 'a;b'"]);
  });

  it('does not split on a semicolon inside a double-quoted identifier', () => {
    expect(getStatements('SELECT "col;name" FROM t;')).toEqual(['SELECT "col;name" FROM t']);
  });

  it('handles an escaped single quote inside a string', () => {
    expect(getStatements("SELECT 'it''s;here';")).toEqual(["SELECT 'it''s;here'"]);
  });

  it('does not split on a semicolon inside a line comment', () => {
    expect(getStatements('SELECT 1; -- comment with ; inside\nSELECT 2;')).toEqual([
      'SELECT 1',
      '-- comment with ; inside\nSELECT 2',
    ]);
  });

  it('does not split on a semicolon inside a block comment', () => {
    expect(getStatements('SELECT 1; /* block ; comment */ SELECT 2;')).toEqual([
      'SELECT 1',
      '/* block ; comment */ SELECT 2',
    ]);
  });

  it('returns an empty array for empty or whitespace-only input', () => {
    expect(getStatements('')).toEqual([]);
    expect(getStatements('   ')).toEqual([]);
  });

  it('includes a trailing statement with no trailing semicolon', () => {
    expect(getStatements('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('trims whitespace around each statement', () => {
    expect(getStatements('  SELECT 1 ;  SELECT 2  ')).toEqual(['SELECT 1', 'SELECT 2']);
  });
});

describe('replaceDimensions', () => {
  it('substitutes %%DIMENSION0%% for a 1D sweep', () => {
    expect(replaceDimensions('SELECT * WHERE x > %%DIMENSION0%%', '5', '')).toBe('SELECT * WHERE x > 5');
  });

  it('substitutes both placeholders for a 2D sweep', () => {
    expect(replaceDimensions('%%DIMENSION0%% and %%DIMENSION1%%', '5', '10')).toBe('5 and 10');
  });

  it('replaces every occurrence of a placeholder', () => {
    expect(replaceDimensions('%%DIMENSION0%% + %%DIMENSION0%%', '5', '')).toBe('5 + 5');
  });

  it('passes through SQL with no placeholders unchanged', () => {
    expect(replaceDimensions('SELECT 1', '5', '10')).toBe('SELECT 1');
  });
});

describe('calculateTotalExecutions', () => {
  it('counts a 1D integer-step sweep', () => {
    expect(calculateTotalExecutions(false, 0, 10, 1, 0, 0, 1)).toBe(11);
  });

  it('counts a 1D float-step sweep without dropping the last value to float drift', () => {
    // 0, 0.1, 0.2, ..., 1.0 — naive float addition would otherwise land just
    // past 1.0 due to drift and miss the final step; FLOAT_TOLERANCE guards this.
    expect(calculateTotalExecutions(false, 0, 1, 0.1, 0, 0, 1)).toBe(11);
  });

  it('counts a 2D sweep as the product of both dimensions', () => {
    expect(calculateTotalExecutions(true, 0, 1, 1, 0, 2, 1)).toBe(2 * 3);
  });
});

describe('iterateExecutions', () => {
  it('iterates a 1D sweep with combinationKey "i,0" and substituted SQL', async () => {
    const seen: { combinationKey: string; sql: string }[] = [];
    await iterateExecutions({
      dim1Active: false,
      start0: 0, end0: 2, step0: 1,
      start1: 0, end1: 0, step1: 1,
      sqlQuery: 'SELECT %%DIMENSION0%%',
      callback: async ({ sql, combinationKey }) => {
        seen.push({ combinationKey, sql });
      },
    });
    expect(seen).toEqual([
      { combinationKey: '0,0', sql: 'SELECT 0' },
      { combinationKey: '1,0', sql: 'SELECT 1' },
      { combinationKey: '2,0', sql: 'SELECT 2' },
    ]);
  });

  it('iterates a 2D sweep with combinationKey "i,j" in nested order', async () => {
    const seen: string[] = [];
    await iterateExecutions({
      dim1Active: true,
      start0: 0, end0: 1, step0: 1,
      start1: 0, end1: 1, step1: 1,
      sqlQuery: '%%DIMENSION0%%/%%DIMENSION1%%',
      callback: async ({ combinationKey }) => {
        seen.push(combinationKey);
      },
    });
    expect(seen).toEqual(['0,0', '0,1', '1,0', '1,1']);
  });

  it('reports progress with the 1-based execution index', async () => {
    const progress: number[] = [];
    await iterateExecutions({
      dim1Active: false,
      start0: 0, end0: 2, step0: 1,
      start1: 0, end1: 0, step1: 1,
      sqlQuery: 'SELECT 1',
      callback: async () => {},
      onProgress: (current) => progress.push(current),
    });
    expect(progress).toEqual([1, 2, 3]);
  });
});

describe('getPlanFingerprint', () => {
  function makePlan(cost: number, scanType: string) {
    return [{
      Plan: {
        'Node Type': 'Hash Join',
        'Total Cost': cost,
        Plans: [
          { 'Node Type': scanType, 'Relation Name': 't1', Alias: 't1' },
          { 'Node Type': 'Seq Scan', 'Relation Name': 't2', Alias: 't2' },
        ],
      },
    }];
  }

  it('produces the same fingerprint for structurally identical plans with different costs', () => {
    const a = getPlanFingerprint(makePlan(100, 'Seq Scan'));
    const b = getPlanFingerprint(makePlan(999, 'Seq Scan'));
    expect(a).toBe(b);
    expect(a).not.toBe('');
  });

  it('produces a different fingerprint for structurally different plans', () => {
    const seqScan = getPlanFingerprint(makePlan(100, 'Seq Scan'));
    const indexScan = getPlanFingerprint(makePlan(100, 'Index Scan'));
    expect(seqScan).not.toBe(indexScan);
  });

  it('returns an empty fingerprint for unparseable input', () => {
    expect(getPlanFingerprint('not valid json')).toBe('');
  });
});

describe('getOrCreatePlanId / createPlanFingerprintState', () => {
  it('allocates a new id for a new fingerprint and reuses it for repeats', () => {
    const state = createPlanFingerprintState();
    const firstId = getOrCreatePlanId(state, 'fingerprint-a', { some: 'plan' });
    const secondId = getOrCreatePlanId(state, 'fingerprint-a', { some: 'plan' });
    expect(secondId).toBe(firstId);
  });

  it('allocates a different id for a different fingerprint', () => {
    const state = createPlanFingerprintState();
    const idA = getOrCreatePlanId(state, 'fingerprint-a', {});
    const idB = getOrCreatePlanId(state, 'fingerprint-b', {});
    expect(idB).not.toBe(idA);
  });

  it('starts a fresh state with no fingerprints and a clean id counter', () => {
    const state1 = createPlanFingerprintState();
    getOrCreatePlanId(state1, 'fingerprint-a', {});
    getOrCreatePlanId(state1, 'fingerprint-b', {});

    const state2 = createPlanFingerprintState();
    expect(state2.planFingerprintMap.size).toBe(0);
    const freshId = getOrCreatePlanId(state2, 'fingerprint-a', {});
    expect(freshId).toBe(1);
  });
});

describe('isSelectStatement', () => {
  it('recognizes a plain SELECT', () => {
    expect(isSelectStatement('SELECT * FROM t')).toBe(true);
  });

  it('recognizes a lowercase select', () => {
    expect(isSelectStatement('select * from t')).toBe(true);
  });

  it('recognizes a CTE (WITH ... SELECT ...)', () => {
    expect(isSelectStatement('WITH cte AS (SELECT 1) SELECT * FROM cte')).toBe(true);
  });

  it('ignores leading/trailing whitespace', () => {
    expect(isSelectStatement('   SELECT 1  ')).toBe(true);
  });

  it('does not match non-query statements', () => {
    expect(isSelectStatement('INSERT INTO t VALUES (1)')).toBe(false);
    expect(isSelectStatement('CREATE TABLE t (id int)')).toBe(false);
  });
});

describe('getProxyHeaders', () => {
  const ENV_KEY = 'NEXT_PUBLIC_PROXY_SHARED_SECRET';

  afterEach(() => {
    delete process.env[ENV_KEY];
  });

  it('omits the x-proxy-secret header when no secret is configured', () => {
    delete process.env[ENV_KEY];
    const headers = getProxyHeaders() as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['x-proxy-secret']).toBeUndefined();
  });

  it('attaches the x-proxy-secret header when a secret is configured', () => {
    process.env[ENV_KEY] = 'my-secret';
    const headers = getProxyHeaders() as Record<string, string>;
    expect(headers['x-proxy-secret']).toBe('my-secret');
  });
});
