/**
 * Unit tests for the LLM quota / bulk-scan rate-limit helpers.
 *
 * Covers:
 *   - default + env-override values for every quota knob
 *   - per-user separation (one user hitting the cap doesn't block others)
 *   - throw shape (TRPCError code TOO_MANY_REQUESTS)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';

// Each test gets a fresh import of the module so its env-derived defaults are
// re-read and the rate-limit Map starts empty. tsx's module loader honours
// query strings as cache-busters (same trick used by r2.test.ts on this
// repo).
type QuotaModule = typeof import('../llm-quota');
let bust = 0;
async function freshImport(): Promise<QuotaModule> {
  bust += 1;
  return (await import(`../llm-quota?bust=${bust}`)) as QuotaModule;
}

const ENV_KEYS = [
  'SHOWBOOK_LLM_CALLS_PER_DAY',
  'SHOWBOOK_BULK_SCAN_PER_HOUR',
  'SHOWBOOK_BULK_SCAN_MESSAGE_CAP',
];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('llmDailyQuota', () => {
  it('defaults to 50 when env unset', async () => {
    const { llmDailyQuota } = await freshImport();
    assert.equal(llmDailyQuota(), 50);
  });

  it('honours SHOWBOOK_LLM_CALLS_PER_DAY when a positive integer', async () => {
    process.env.SHOWBOOK_LLM_CALLS_PER_DAY = '7';
    const { llmDailyQuota } = await freshImport();
    assert.equal(llmDailyQuota(), 7);
  });

  it('falls back to 50 when env is non-numeric or non-positive', async () => {
    process.env.SHOWBOOK_LLM_CALLS_PER_DAY = 'banana';
    let mod = await freshImport();
    assert.equal(mod.llmDailyQuota(), 50);

    process.env.SHOWBOOK_LLM_CALLS_PER_DAY = '0';
    mod = await freshImport();
    assert.equal(mod.llmDailyQuota(), 50);

    process.env.SHOWBOOK_LLM_CALLS_PER_DAY = '-5';
    mod = await freshImport();
    assert.equal(mod.llmDailyQuota(), 50);
  });
});

describe('bulkScanHourlyQuota', () => {
  it('defaults to 5 when env unset', async () => {
    const { bulkScanHourlyQuota } = await freshImport();
    assert.equal(bulkScanHourlyQuota(), 5);
  });

  it('honours SHOWBOOK_BULK_SCAN_PER_HOUR override', async () => {
    process.env.SHOWBOOK_BULK_SCAN_PER_HOUR = '2';
    const { bulkScanHourlyQuota } = await freshImport();
    assert.equal(bulkScanHourlyQuota(), 2);
  });
});

describe('bulkScanMessageCap', () => {
  it('defaults to 200 when env unset', async () => {
    const { bulkScanMessageCap } = await freshImport();
    assert.equal(bulkScanMessageCap(), 200);
  });

  it('honours SHOWBOOK_BULK_SCAN_MESSAGE_CAP override', async () => {
    process.env.SHOWBOOK_BULK_SCAN_MESSAGE_CAP = '10';
    const { bulkScanMessageCap } = await freshImport();
    assert.equal(bulkScanMessageCap(), 10);
  });
});

describe('enforceLLMQuota', () => {
  it('allows up to the daily cap then throws TOO_MANY_REQUESTS', async () => {
    process.env.SHOWBOOK_LLM_CALLS_PER_DAY = '3';
    const { enforceLLMQuota } = await freshImport();
    const userId = 'user-quota-cap';
    enforceLLMQuota(userId);
    enforceLLMQuota(userId);
    enforceLLMQuota(userId);
    assert.throws(
      () => enforceLLMQuota(userId),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('keeps per-user quotas independent', async () => {
    process.env.SHOWBOOK_LLM_CALLS_PER_DAY = '2';
    const { enforceLLMQuota } = await freshImport();
    enforceLLMQuota('alice');
    enforceLLMQuota('alice');
    assert.throws(() => enforceLLMQuota('alice'), TRPCError);
    // bob has not used any quota yet
    assert.doesNotThrow(() => enforceLLMQuota('bob'));
    assert.doesNotThrow(() => enforceLLMQuota('bob'));
    assert.throws(() => enforceLLMQuota('bob'), TRPCError);
  });
});

describe('enforceBulkScanRateLimit', () => {
  it('allows up to the hourly cap then throws TOO_MANY_REQUESTS', async () => {
    process.env.SHOWBOOK_BULK_SCAN_PER_HOUR = '2';
    const { enforceBulkScanRateLimit } = await freshImport();
    const userId = 'bulk-user';
    enforceBulkScanRateLimit(userId);
    enforceBulkScanRateLimit(userId);
    assert.throws(
      () => enforceBulkScanRateLimit(userId),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('uses a separate bucket from enforceLLMQuota', async () => {
    process.env.SHOWBOOK_BULK_SCAN_PER_HOUR = '1';
    process.env.SHOWBOOK_LLM_CALLS_PER_DAY = '1';
    const { enforceBulkScanRateLimit, enforceLLMQuota } = await freshImport();
    const userId = 'shared-user';
    // burning the LLM quota must not affect the bulk-scan bucket
    enforceLLMQuota(userId);
    assert.throws(() => enforceLLMQuota(userId), TRPCError);
    assert.doesNotThrow(() => enforceBulkScanRateLimit(userId));
    assert.throws(() => enforceBulkScanRateLimit(userId), TRPCError);
  });
});
