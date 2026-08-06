/**
 * LLM quota knobs and enforcement.
 *
 * The enforcement moved to the durable budget layer (`budget.ts`, backed by
 * `mcp-budget-governor` over Postgres): the daily quota now survives
 * redeploys — previously the in-process Map reset to zero and handed every user
 * a fresh 50-call day — and `enforceLLMQuota` also checks the deployment-wide
 * daily *spend* ceiling, so job-free traffic can't run the operator's bill past
 * `SHOWBOOK_LLM_DAILY_BUDGET_USD` no matter how many users stay under their
 * individual caps.
 *
 * The env-knob readers keep their names and defaults; the enforcement
 * functions are now async (they hit Postgres) and still throw
 * `TRPCError(TOO_MANY_REQUESTS)`.
 */

import { enforceBulkScanQuota, enforceLLMBudget, enforceLLMCallQuota } from './budget';

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function llmDailyQuota(): number {
  return readPositiveInt('SHOWBOOK_LLM_CALLS_PER_DAY', 50);
}

export function bulkScanHourlyQuota(): number {
  return readPositiveInt('SHOWBOOK_BULK_SCAN_PER_HOUR', 5);
}

export function bulkScanMessageCap(): number {
  return readPositiveInt('SHOWBOOK_BULK_SCAN_MESSAGE_CAP', 200);
}

/**
 * Admit one user-initiated LLM call: the caller's daily quota, then the global
 * spend breaker. Order matters — the per-user check is gated (a refused call is
 * not charged), so checking it first means a user at their cap doesn't hit the
 * budget gate at all.
 */
export async function enforceLLMQuota(userId: string): Promise<void> {
  await enforceLLMCallQuota(userId, llmDailyQuota());
  await enforceLLMBudget();
}

export async function enforceBulkScanRateLimit(userId: string): Promise<void> {
  await enforceBulkScanQuota(userId, bulkScanHourlyQuota());
}
