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

/**
 * Bind parameters are for diagnostic SELECTs — queue names, row limits, time
 * windows. A dozen is already generous; the cap exists so a caller can't hand
 * Postgres an enormous parameter list to plan around.
 */
export const MAX_PARAMS = 32;
export const MAX_PARAM_LENGTH = 10_000;

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

/** A value that can safely be bound to a placeholder. */
export type AdminQueryParam = string | number | boolean | null;

export type ParamsValidationResult =
  | { ok: true; params: AdminQueryParam[] }
  | { ok: false; reason: string };

/**
 * Validate the optional `params` array that accompanies a query.
 *
 * Bind parameters are what make this endpoint usable by a *program* rather
 * than only by a human pasting SQL — a client that has to inline its own
 * literals to reach this endpoint would be building an injection sink for no
 * reason. Passing them through to Postgres as parameters keeps values out of
 * the parsed statement entirely.
 *
 * Only JSON scalars are accepted. Objects and arrays would reach postgres-js
 * as json / array types, which no diagnostic query here needs, and a narrow
 * contract is easy to widen later — the reverse is not.
 */
export function validateAdminParams(input: unknown): ParamsValidationResult {
  if (input === undefined || input === null) return { ok: true, params: [] };

  if (!Array.isArray(input)) {
    return { ok: false, reason: 'params must be an array' };
  }
  if (input.length > MAX_PARAMS) {
    return { ok: false, reason: `too many params (max ${MAX_PARAMS})` };
  }

  const params: AdminQueryParam[] = [];
  for (let i = 0; i < input.length; i++) {
    const value: unknown = input[i];
    if (value === null || typeof value === 'boolean') {
      params.push(value);
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return { ok: false, reason: `params[${i}] must be a finite number` };
      }
      params.push(value);
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > MAX_PARAM_LENGTH) {
        return {
          ok: false,
          reason: `params[${i}] too long (max ${MAX_PARAM_LENGTH} chars)`,
        };
      }
      params.push(value);
      continue;
    }
    return {
      ok: false,
      reason: `params[${i}] must be a string, number, boolean, or null`,
    };
  }

  return { ok: true, params };
}

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

  // Reject recursive CTEs. A `WITH RECURSIVE` can spin a self-referencing
  // term that burns CPU/memory right up to the statement_timeout — the
  // READ ONLY transaction doesn't bound compute, only writes. Plain CTEs are
  // fine. `RECURSIVE` must follow `WITH` directly in Postgres, so anchoring
  // on the (comment-stripped) start is sufficient.
  if (verb === 'WITH' && /^WITH\s+RECURSIVE\b/i.test(stripped)) {
    return {
      ok: false,
      reason: 'recursive CTEs are not allowed on the read-only diagnostic endpoint',
    };
  }

  return { ok: true, query: input };
}
