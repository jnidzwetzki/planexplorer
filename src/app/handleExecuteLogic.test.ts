import { describe, expect, it } from 'vitest';
import { getStatements } from './handleExecuteLogic';

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
