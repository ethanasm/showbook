import { enforceRateLimit } from './rate-limit';

const DAY_MS = 24 * 60 * 60 * 1000;

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

export function enforceLLMQuota(userId: string): void {
  enforceRateLimit(`llm:${userId}`, {
    max: llmDailyQuota(),
    windowMs: DAY_MS,
  });
}

export function enforceBulkScanRateLimit(userId: string): void {
  enforceRateLimit(`bulk-scan:${userId}`, {
    max: bulkScanHourlyQuota(),
    windowMs: 60 * 60 * 1000,
  });
}
