/**
 * Guard logic for the /api/admin/sql endpoint.
 *
 * The endpoint exists so the operator (and Claude Code on the web) can run
 * read-only diagnostic queries against the prod database without exposing
 * Postgres on the LAN. Three layers of defense, deepest-first:
 *
 *   1. Bearer-token auth (in route.ts) — only callers holding
 *      `ADMIN_QUERY_TOKEN` can reach the endpoint.
 *   2. Postgres `BEGIN READ ONLY` transaction (in route.ts) — the engine
 *      itself rejects any INSERT/UPDATE/DELETE/DDL with `cannot execute
 *      <op> in a read-only transaction`. This is the security boundary.
 *   3. Prefix allowlist (this file) — early UX-friendly rejection of
 *      obviously-wrong inputs before they hit Postgres. Rejecting an
 *      INSERT here is a courtesy; even if it slipped past, layer 2
 *      stops it.
 *
 * Don't move the security boundary to this file. SQL parsing is hard,
 * and a permissive `validateAdminQuery` is fine as long as the engine
 * is configured READ ONLY.
 */

export const MAX_QUERY_LENGTH = 10_000;

const ALLOWED_VERBS = new Set([
  'SELECT',
  'EXPLAIN',
  'WITH',
  'SHOW',
  'TABLE',
  'VALUES',
]);

export type ValidationResult =
  | { ok: true; query: string }
  | { ok: false; reason: string };

/**
 * Strip leading SQL comments and whitespace so we can find the first verb.
 * Handles `--` line comments and `/* ... *\/` block comments. Doesn't try
 * to handle every weird case (nested block comments, dollar-quoted strings)
 * — anything tricky just falls through to the engine-level READ ONLY guard.
 */
function stripLeadingPreamble(input: string): string {
  let s = input;
  for (;;) {
    const before = s;
    s = s.replace(/^\s+/, '');
    if (s.startsWith('--')) {
      const nl = s.indexOf('\n');
      s = nl === -1 ? '' : s.slice(nl + 1);
    } else if (s.startsWith('/*')) {
      const end = s.indexOf('*/');
      s = end === -1 ? '' : s.slice(end + 2);
    }
    if (s === before) break;
  }
  return s;
}

/**
 * Reject inputs that contain more than one statement.
 *
 * postgres-js sends `query()` text as a single statement, but Postgres'
 * simple-query protocol DOES support multi-statement strings — so we have
 * to reject `SELECT 1; SELECT 2` ourselves. We allow exactly one trailing
 * `;` (and trailing whitespace), which is how most operators paste queries.
 *
 * This is a conservative check. It doesn't account for `;` inside string
 * literals or comments — but those would be unusual in a diagnostic
 * query, and the worst case is a false rejection, not a security hole
 * (the engine-level READ ONLY tx is still the boundary).
 */
function hasMultipleStatements(stripped: string): boolean {
  const trimmed = stripped.replace(/\s+$/, '');
  // Find the first `;` that isn't the very last non-whitespace char.
  const firstSemi = trimmed.indexOf(';');
  if (firstSemi === -1) return false;
  return firstSemi !== trimmed.length - 1;
}

export function validateAdminQuery(input: unknown): ValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, reason: 'query must be a string' };
  }
  if (input.length > MAX_QUERY_LENGTH) {
    return {
      ok: false,
      reason: `query too long (max ${MAX_QUERY_LENGTH} chars)`,
    };
  }

  const stripped = stripLeadingPreamble(input);
  if (stripped.trim().length === 0) {
    return { ok: false, reason: 'query is empty' };
  }

  if (hasMultipleStatements(stripped)) {
    return {
      ok: false,
      reason: 'multiple statements not allowed; send a single statement',
    };
  }

  // Read the first word, case-insensitive.
  const verbMatch = stripped.match(/^([A-Za-z]+)/);
  const verb = verbMatch?.[1]?.toUpperCase() ?? '';
  if (!ALLOWED_VERBS.has(verb)) {
    return {
      ok: false,
      reason: `verb "${verb || '<empty>'}" not allowed; only ${[...ALLOWED_VERBS].join(', ')} are accepted`,
    };
  }

  return { ok: true, query: input };
}
