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
/**
 * A parameter may be a one-level array — `where name = any($1)` is how you
 * filter by a set without generating N placeholders, so refusing arrays would
 * refuse an ordinary query shape. Bounded so a single parameter can't carry an
 * unbounded list for Postgres to plan around.
 */
export const MAX_PARAM_ARRAY_LENGTH = 1_000;

/**
 * Ceiling on the whole request body.
 *
 * The per-item caps above bound what Postgres is asked to plan, not what Node
 * holds: multiplied out they would admit 32 × 1000 × 10_000 chars. This is the
 * cap that actually matters, and it is enforced by draining the stream rather
 * than by trusting Content-Length. A real diagnostic query with parameters is
 * a few kilobytes.
 */
export const MAX_BODY_BYTES = 1_048_576;

/**
 * Options forcing postgres-js onto the extended query protocol.
 *
 * Simple mode is the only Postgres protocol that can carry more than one
 * command in a single message, so pinning extended mode makes
 * `select 1; select 2` impossible at the protocol level rather than something
 * `hasMultipleStatements` has to catch by inspecting text. postgres-js
 * otherwise chooses simple mode whenever there are no parameters
 * (`'simple' in options ? options.simple : args.length === 0`).
 *
 * The cast is because that runtime behaviour is real but undeclared: the
 * shipped `UnsafeQueryOptions` type lists only `prepare`. Asserted in rather
 * than dropped, because this is a security property, not a preference.
 */
export const EXTENDED_PROTOCOL_ONLY = {
  simple: false,
} as unknown as { prepare?: boolean | undefined };

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
export type AdminQueryScalar = string | number | boolean | null;
export type AdminQueryParam = AdminQueryScalar | AdminQueryScalar[];

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
 * Accepted values are JSON scalars and one-level arrays of them (the latter
 * for `= any($1)`). Objects are refused, and so is nesting: neither is needed
 * by a diagnostic query, and a narrow contract is easy to widen later — the
 * reverse is not.
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

    if (Array.isArray(value)) {
      if (value.length > MAX_PARAM_ARRAY_LENGTH) {
        return {
          ok: false,
          reason: `params[${i}] has too many elements (max ${MAX_PARAM_ARRAY_LENGTH})`,
        };
      }
      const elements: AdminQueryScalar[] = [];
      for (let j = 0; j < value.length; j++) {
        const element = validateScalar(value[j], `params[${i}][${j}]`);
        if (!element.ok) return { ok: false, reason: element.reason };
        // Booleans inside an array are refused because postgres-js mis-binds
        // them, measured against Postgres 16: its type inference recurses into
        // the array and declares the *element* OID (bool), so the Describe
        // round-trip has nothing left to correct and the scalar bool
        // serializer is applied to the whole array. `select $1::bool` with
        // [[true]] returns false — silently, no error — and
        // `x = any($1)` raises 42809. Neither is a shape a real query wants:
        // `where flag = any(array[true])` is just `where flag`. Strings and
        // numbers infer as unknown, so Describe fills the type and they bind
        // correctly.
        if (typeof element.value === 'boolean') {
          return {
            ok: false,
            reason: `params[${i}][${j}] must not be a boolean; booleans are only supported as top-level params`,
          };
        }
        elements.push(element.value);
      }
      params.push(elements);
      continue;
    }

    const scalar = validateScalar(value, `params[${i}]`);
    if (!scalar.ok) return { ok: false, reason: scalar.reason };
    params.push(scalar.value);
  }

  return { ok: true, params };
}

type ScalarResult =
  | { ok: true; value: AdminQueryScalar }
  | { ok: false; reason: string };

function validateScalar(value: unknown, path: string): ScalarResult {
  if (value === null || typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') {
    // NaN / Infinity have no JSON representation and no Postgres equivalent
    // for the types these queries bind; they arrive only from a buggy client.
    if (!Number.isFinite(value)) {
      return { ok: false, reason: `${path} must be a finite number` };
    }
    return { ok: true, value };
  }
  if (typeof value === 'string') {
    if (value.length > MAX_PARAM_LENGTH) {
      return { ok: false, reason: `${path} too long (max ${MAX_PARAM_LENGTH} chars)` };
    }
    return { ok: true, value };
  }
  return {
    ok: false,
    reason: `${path} must be a string, number, boolean, or null`,
  };
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
