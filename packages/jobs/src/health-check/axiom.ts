import { child } from '@showbook/observability';

const log = child({ component: 'health-check.axiom' });

const APL_ENDPOINT = 'https://api.axiom.co/v1/datasets/_apl?format=tabular';
const DEFAULT_ORG = 'showbook-egap';
const DEFAULT_DATASET = 'showbook-prod';
const REQUEST_TIMEOUT_MS = 15_000;

export interface AxiomQueryConfig {
  /** Defaults to the `AXIOM_QUERY_TOKEN` env var. Read-capable PAT. */
  token?: string;
  /** Defaults to `AXIOM_ORG_ID` env or `showbook-egap`. */
  orgId?: string;
  /** Defaults to `AXIOM_QUERY_DATASET` env or `showbook-prod`. */
  dataset?: string;
}

export interface AxiomQueryResult<TRow extends object> {
  /** `null` when the query was skipped (no token configured). Callers
   *  should treat skipped as "unknown", not "ok". */
  rows: TRow[] | null;
  /** True when the call hit the network and returned a 2xx. */
  ok: boolean;
  skipped: boolean;
  durationMs: number;
  error?: string;
}

interface TabularResponse {
  format?: string;
  status?: { rowsExamined?: number; rowsMatched?: number };
  tables?: Array<{
    name?: string;
    fields?: Array<{ name: string; type: string }>;
    columns?: unknown[][];
  }>;
}

function getConfig(cfg?: AxiomQueryConfig): {
  token: string | null;
  orgId: string;
  dataset: string;
} {
  return {
    token: cfg?.token ?? process.env.AXIOM_QUERY_TOKEN ?? null,
    orgId: cfg?.orgId ?? process.env.AXIOM_ORG_ID ?? DEFAULT_ORG,
    dataset: cfg?.dataset ?? process.env.AXIOM_QUERY_DATASET ?? DEFAULT_DATASET,
  };
}

/**
 * Tabular APL responses come back as columnar arrays (one array per
 * field). Zip them into row objects so callers can read by field name.
 */
function tabularToRows<TRow extends object>(
  body: TabularResponse,
): TRow[] {
  const table = body.tables?.[0];
  if (!table) return [];
  const fields = table.fields ?? [];
  const columns = table.columns ?? [];
  if (fields.length === 0 || columns.length === 0) return [];
  const rowCount = columns[0]?.length ?? 0;
  const out: TRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    const row: Record<string, unknown> = {};
    for (let f = 0; f < fields.length; f++) {
      row[fields[f]!.name] = columns[f]?.[i] ?? null;
    }
    out.push(row as TRow);
  }
  return out;
}

/**
 * Run an APL query against Axiom. The APL string is taken as-is; callers
 * are expected to scope to a dataset like `["showbook-prod"]`. When
 * `AXIOM_QUERY_TOKEN` is unset (dev, tests) the call is skipped and
 * `rows` is `null` so callers can render "unknown" instead of "ok".
 */
export async function queryAxiom<TRow extends object>(
  apl: string,
  cfg?: AxiomQueryConfig,
): Promise<AxiomQueryResult<TRow>> {
  const startedAt = Date.now();
  const { token, orgId } = getConfig(cfg);

  if (!token) {
    log.debug(
      { event: 'health.check.axiom.skipped' },
      'AXIOM_QUERY_TOKEN unset; skipping APL query',
    );
    return { rows: null, ok: false, skipped: true, durationMs: 0 };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(APL_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-AXIOM-ORG-ID': orgId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ apl }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const error = `axiom http ${res.status}: ${text.slice(0, 200)}`;
      log.warn(
        { event: 'health.check.axiom.http_error', status: res.status },
        error,
      );
      return {
        rows: null,
        ok: false,
        skipped: false,
        durationMs: Date.now() - startedAt,
        error,
      };
    }

    const body = (await res.json()) as TabularResponse;
    const rows = tabularToRows<TRow>(body);
    return {
      rows,
      ok: true,
      skipped: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn({ event: 'health.check.axiom.failed', err }, 'APL query failed');
    return {
      rows: null,
      ok: false,
      skipped: false,
      durationMs: Date.now() - startedAt,
      error,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const _testing = { tabularToRows };
