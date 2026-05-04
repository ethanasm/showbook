import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateAdminQuery, MAX_QUERY_LENGTH } from '../admin-query';

describe('validateAdminQuery', () => {
  it('accepts a simple SELECT', () => {
    const r = validateAdminQuery('SELECT 1');
    assert.equal(r.ok, true);
  });

  it('accepts SELECT with leading whitespace and newlines', () => {
    const r = validateAdminQuery('  \n  select count(*) from users\n');
    assert.equal(r.ok, true);
  });

  it('accepts SELECT with trailing semicolon', () => {
    const r = validateAdminQuery('SELECT 1;');
    assert.equal(r.ok, true);
  });

  it('accepts EXPLAIN', () => {
    const r = validateAdminQuery('EXPLAIN SELECT * FROM users');
    assert.equal(r.ok, true);
  });

  it('accepts EXPLAIN ANALYZE — even though it can run write side-effects, the READ ONLY transaction blocks them', () => {
    // ANALYZE-style side-effects are caught by the engine-level READ ONLY tx.
    // The prefix guard is for early UX rejection, not the security boundary.
    const r = validateAdminQuery('EXPLAIN ANALYZE SELECT * FROM users');
    assert.equal(r.ok, true);
  });

  it('accepts WITH (CTE)', () => {
    const r = validateAdminQuery('WITH t AS (SELECT 1) SELECT * FROM t');
    assert.equal(r.ok, true);
  });

  it('accepts SHOW', () => {
    const r = validateAdminQuery('SHOW server_version');
    assert.equal(r.ok, true);
  });

  it('accepts TABLE shorthand', () => {
    const r = validateAdminQuery('TABLE users');
    assert.equal(r.ok, true);
  });

  it('accepts VALUES', () => {
    const r = validateAdminQuery("VALUES (1, 'a'), (2, 'b')");
    assert.equal(r.ok, true);
  });

  it('rejects INSERT', () => {
    const r = validateAdminQuery("INSERT INTO users (id) VALUES ('1')");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /not allowed/i);
  });

  it('rejects UPDATE', () => {
    const r = validateAdminQuery("UPDATE users SET name = 'x'");
    assert.equal(r.ok, false);
  });

  it('rejects DELETE', () => {
    const r = validateAdminQuery('DELETE FROM users');
    assert.equal(r.ok, false);
  });

  it('rejects DROP', () => {
    const r = validateAdminQuery('DROP TABLE users');
    assert.equal(r.ok, false);
  });

  it('rejects TRUNCATE', () => {
    const r = validateAdminQuery('TRUNCATE users');
    assert.equal(r.ok, false);
  });

  it('rejects ALTER', () => {
    const r = validateAdminQuery('ALTER TABLE users ADD COLUMN foo TEXT');
    assert.equal(r.ok, false);
  });

  it('rejects empty input', () => {
    const r = validateAdminQuery('');
    assert.equal(r.ok, false);
  });

  it('rejects whitespace-only input', () => {
    const r = validateAdminQuery('   \n\t  ');
    assert.equal(r.ok, false);
  });

  it('rejects non-string input', () => {
    const r = validateAdminQuery(undefined as unknown as string);
    assert.equal(r.ok, false);
  });

  it(`rejects queries longer than ${MAX_QUERY_LENGTH} chars`, () => {
    const big = 'SELECT ' + "'x', ".repeat(MAX_QUERY_LENGTH);
    const r = validateAdminQuery(big);
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /too long/i);
  });

  it('rejects multi-statement input (statement separator)', () => {
    // Even though postgres-js parameterizes via a single text query, allowing
    // semicolon-separated statements would let a caller chain through the
    // BEGIN/ROLLBACK wrapper. Reject anything with a non-trailing `;`.
    const r = validateAdminQuery('SELECT 1; SELECT 2');
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /multiple statements|single statement/i);
  });

  it('allows a single trailing semicolon', () => {
    const r = validateAdminQuery('SELECT 1;');
    assert.equal(r.ok, true);
  });

  it('allows a single trailing semicolon with trailing whitespace', () => {
    const r = validateAdminQuery('SELECT 1;   \n');
    assert.equal(r.ok, true);
  });

  it('treats SQL line comments before the verb as preamble', () => {
    const r = validateAdminQuery('-- comment\nSELECT 1');
    assert.equal(r.ok, true);
  });

  it('treats SQL block comments before the verb as preamble', () => {
    const r = validateAdminQuery('/* comment */ SELECT 1');
    assert.equal(r.ok, true);
  });

  it('does not be fooled by SELECT inside a string literal of an INSERT', () => {
    const r = validateAdminQuery("INSERT INTO logs (msg) VALUES ('SELECT 1')");
    assert.equal(r.ok, false);
  });
});
