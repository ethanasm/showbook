/**
 * The durable budget layer, backed by `@ethanasm/mcp-budget-governor`.
 *
 * Showbook's per-minute buckets (`rate-limit.ts`) deliberately stay in-process:
 * this is a single-process deployment, those windows clear in a minute, and the
 * ~25 synchronous call sites are not worth an async migration that a missed
 * `await` would silently bypass. What moves here is the layer where durability
 * and global scope actually matter — the ceilings denominated in days and
 * dollars:
 *
 * - **Per-user daily LLM call quota** and the **bulk-scan hourly quota**, which
 *   previously lived in the in-process Map and reset to zero on every deploy —
 *   a redeploy handed every user a fresh 50-call day.
 * - **A global daily LLM spend ceiling in USD** — previously *nothing*: the
 *   only LLM control was per-user call counts, so N users × 50 calls/day was
 *   unbounded from the operator's wallet, and Langfuse recorded token usage
 *   that nothing read back to enforce.
 * - **The iTunes lookup limit**, which is Apple's ~20/min per *IP* — global for
 *   this deployment — but was enforced per user, so users could collectively
 *   blow through it.
 *
 * Counters live in Postgres (`mcpbg_counters` + three functions, schema owned
 * and auto-created by the library the same way pg-boss owns its schema) via the
 * one pool `@showbook/db` already runs. Without `DATABASE_URL` — unit tests,
 * offline dev — the governor falls back to the in-process backend, mirroring
 * the observability package's "must work with the env unset" rule.
 */

import {
  Governor,
  Limit,
  MemoryBackend,
  Policy,
  PostgresBackend,
  PriceTable,
  Scope,
  Unit,
  Window,
  usd,
  type Backend,
  type Context,
  type MeterResult,
} from '@ethanasm/mcp-budget-governor';
import { TRPCError } from '@trpc/server';
import { pgClient } from '@showbook/db';
import { child } from '@showbook/observability';

const log = child({ component: 'budget-governor' });

function readPositiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** The operator-wide daily LLM spend ceiling, in dollars. Default $5/day. */
export function llmDailyBudgetUsd(): number {
  return readPositiveNumber('SHOWBOOK_LLM_DAILY_BUDGET_USD', 5);
}

/**
 * Groq list prices, dollars per Mtok (input, output).
 *
 * gpt-oss-120b's figures are documented in `groq.ts` alongside the model
 * choice. The vision model's are a deliberate over-estimate pending
 * verification against Groq's price page — a budget that over-counts trips
 * early, which is the safe direction to be wrong in, and vision calls are a
 * tiny fraction of traffic. An unknown model *raises* rather than pricing at
 * zero, so adding a model to `groq.ts` without pricing it here fails loudly on
 * the first metered call instead of silently uncapping that path.
 */
const GROQ_PRICES = PriceTable.of({
  'openai/gpt-oss-120b': [0.15, 0.6],
  'qwen/qwen3.6-27b': [0.6, 1.2],
});

/** The one metric name the spend ceiling meters under. */
export const LLM_SPEND_LIMIT = 'llm_spend';

const LIMIT_NAMES = {
  llmDaily: 'llm_daily',
  bulkScanHourly: 'bulk_scan_hourly',
  itunesMinute: 'itunes_lookups',
} as const;

/**
 * One backend for the process. Postgres when a database is configured (the
 * durable path — prod, dev stacks, integration tests), in-process otherwise
 * (unit tests, offline dev). The selection is at module load: showbook boots
 * with or without a database, never both.
 */
function makeBackend(): Backend {
  if (!process.env.DATABASE_URL) return new MemoryBackend();
  return new PostgresBackend({
    // postgres-js: `unsafe` with params uses the extended protocol (single
    // statement); without params it must use the simple protocol so the
    // multi-statement schema file can run.
    query: (text, params) =>
      params.length > 0 ? pgClient.unsafe(text, params as never[]) : pgClient.unsafe(text),
  });
}

const backend = makeBackend();

/**
 * Test hook, following setlistfm.ts's `_resetRateLimitState` precedent: global
 * limits share one counter per window across a whole test file, so tests that
 * assert exact admission counts reset it first. On the in-process backend
 * `close()` clears the counter map; on Postgres it is a no-op by design —
 * tests that need resets run without DATABASE_URL.
 */
export async function _resetBudgetCountersForTests(): Promise<void> {
  await backend.close();
}

/** Idempotent, awaited once per process before the first counter touch. */
let schemaReady: Promise<void> | null = null;
function ensureReady(): Promise<void> {
  if (!schemaReady) {
    schemaReady =
      backend instanceof PostgresBackend
        ? backend.ensureSchema().catch((err: unknown) => {
            // Don't cache a failed boot: clear so the next call retries, and
            // let the caller's operation surface (and fail open) on its own.
            schemaReady = null;
            log.warn({ err, event: 'budget.schema_init_failed' }, 'mcpbg schema init failed');
          })
        : Promise.resolve();
  }
  return schemaReady;
}

const governorLogger = {
  info: (message: string, fields?: Record<string, unknown>) => log.info(fields ?? {}, message),
  warn: (message: string, fields?: Record<string, unknown>) => log.warn(fields ?? {}, message),
};

function governorFor(limit: Limit): Governor {
  // Per-call one-limit policies, because the caps are env-derived at call time
  // (tests override them per test). Two small frozen objects per call.
  return new Governor(Policy.of(limit), {
    backend,
    prices: GROQ_PRICES,
    logger: governorLogger,
  });
}

const tooMany = (message: string) =>
  new TRPCError({ code: 'TOO_MANY_REQUESTS', message });

/**
 * Gated consume of one unit against a limit; throws TRPCError when refused.
 * Fails open when the backend errors (the governor logs it) — matching every
 * other limiter in this codebase: a broken database should degrade features,
 * not turn every request into a 500 via its rate limiter.
 */
async function consumeOrThrow(limit: Limit, context: Context, message: string): Promise<void> {
  await ensureReady();
  const decision = await governorFor(limit).check(context);
  if (!decision.allowed) throw tooMany(message);
}

/** Per-user daily LLM call quota. Durable: survives redeploys now. */
export async function enforceLLMCallQuota(userId: string, max: number): Promise<void> {
  await consumeOrThrow(
    new Limit({ name: LIMIT_NAMES.llmDaily, cap: max, window: Window.DAY, scope: Scope.USER }),
    { user: userId },
    'Daily AI-assist quota reached; resets at midnight UTC.',
  );
}

/** Per-user hourly bulk-scan quota. */
export async function enforceBulkScanQuota(userId: string, max: number): Promise<void> {
  await consumeOrThrow(
    new Limit({
      name: LIMIT_NAMES.bulkScanHourly,
      cap: max,
      window: Window.HOUR,
      scope: Scope.USER,
    }),
    { user: userId },
    'Bulk-scan rate limit exceeded; please slow down.',
  );
}

/**
 * The deployment-wide iTunes lookup limit. Apple throttles ~20/min per IP, and
 * this deployment is one IP — scoping this per user (as it was) let users
 * collectively exceed it. Returns whether the caller should skip, mirroring
 * the `isRateLimited` shape the call site branches on.
 */
export async function isItunesLookupLimited(): Promise<boolean> {
  await ensureReady();
  const limit = new Limit({
    name: LIMIT_NAMES.itunesMinute,
    cap: readPositiveNumber('SHOWBOOK_ITUNES_LOOKUPS_PER_MINUTE', 20),
    window: Window.MINUTE,
    scope: Scope.GLOBAL,
  });
  const decision = await governorFor(limit).check({});
  return !decision.allowed;
}

function spendLimit(): Limit {
  return new Limit({
    name: LLM_SPEND_LIMIT,
    cap: usd(llmDailyBudgetUsd()),
    window: Window.DAY,
    scope: Scope.GLOBAL,
    unit: Unit.USD_MICROS,
    breaker: true,
    gated: false, // spend already incurred is always recorded
  });
}

/**
 * The global spend breaker's read-only gate: cheap to call before any Groq
 * request. Throws when the deployment's daily LLM budget is exhausted. Fails
 * open on backend errors — a store that cannot answer is not evidence of a
 * breach.
 */
export async function enforceLLMBudget(): Promise<void> {
  await ensureReady();
  if (await governorFor(spendLimit()).isTripped(LLM_SPEND_LIMIT)) {
    log.warn(
      { event: 'llm.budget.rejected', budgetUsd: llmDailyBudgetUsd() },
      'LLM call rejected: daily spend budget exhausted',
    );
    throw tooMany('Daily AI budget exhausted; resets at midnight UTC.');
  }
}

/**
 * Charge one completed Groq call to the global spend ceiling. Never throws —
 * the call already happened and this runs on its success path — and logs
 * `llm.budget.tripped` exactly once per day, on the call that crosses the line.
 */
export async function meterLLMSpend(
  model: string,
  tokens: { promptTokens?: number; completionTokens?: number } | undefined,
): Promise<MeterResult | null> {
  try {
    await ensureReady();
    const result = await governorFor(spendLimit()).meterTokens(LLM_SPEND_LIMIT, model, {
      inputTokens: tokens?.promptTokens ?? 0,
      outputTokens: tokens?.completionTokens ?? 0,
    });
    if (result.crossed) {
      log.warn(
        {
          event: 'llm.budget.tripped',
          totalUsdMicros: result.total,
          budgetUsd: llmDailyBudgetUsd(),
        },
        'Daily LLM spend budget crossed; further calls will be shed',
      );
    }
    return result;
  } catch (err) {
    // An unpriced model or a backend blip must not fail the user's request on
    // its success path — but it must be visible, because unmetered spend is
    // exactly what this module exists to prevent.
    log.warn({ err, model, event: 'llm.spend.meter_failed' }, 'LLM spend metering failed');
    return null;
  }
}
