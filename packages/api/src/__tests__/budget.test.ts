/**
 * Unit tests for the durable budget layer (`budget.ts`).
 *
 * These run without DATABASE_URL, so the governor sits on the in-process
 * backend — the semantics under test (pricing, the breaker tripping exactly
 * once, the gate shedding, the global iTunes scope) are backend-independent,
 * and the Postgres backend itself is tested in the library against a real
 * Postgres, including under real concurrency.
 *
 * Global limits share one counter per UTC day across this whole file (that is
 * the point of them), so the spend tests manage the budget env knob explicitly
 * rather than assuming a clean slate.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';

import {
  enforceLLMBudget,
  isItunesLookupLimited,
  llmDailyBudgetUsd,
  meterLLMSpend,
} from '../budget';

beforeEach(() => {
  delete process.env.SHOWBOOK_LLM_DAILY_BUDGET_USD;
  delete process.env.SHOWBOOK_ITUNES_LOOKUPS_PER_MINUTE;
});

describe('llmDailyBudgetUsd', () => {
  it('defaults to $5/day and honours the env override', () => {
    assert.equal(llmDailyBudgetUsd(), 5);
    process.env.SHOWBOOK_LLM_DAILY_BUDGET_USD = '2.5';
    assert.equal(llmDailyBudgetUsd(), 2.5);
    process.env.SHOWBOOK_LLM_DAILY_BUDGET_USD = 'banana';
    assert.equal(llmDailyBudgetUsd(), 5);
  });
});

describe('meterLLMSpend + enforceLLMBudget', () => {
  it('prices a call at Groq rates, in USD millionths', async () => {
    // 1M input tokens of gpt-oss-120b at $0.15/Mtok = $0.15 = 150_000 micros.
    const result = await meterLLMSpend('openai/gpt-oss-120b', {
      promptTokens: 1_000_000,
      completionTokens: 0,
    });
    assert.ok(result);
    assert.equal(result.total >= 150_000, true);
  });

  it('never throws on an unpriced model, but reports null', async () => {
    // A typo'd or newly added model must not fail the user's request on its
    // success path — the warn log is the signal that spend went unmetered.
    const result = await meterLLMSpend('groq/some-new-model', {
      promptTokens: 10,
      completionTokens: 10,
    });
    assert.equal(result, null);
  });

  it('trips exactly once, and the gate sheds only while over budget', async () => {
    // Tiny budget: one big call crosses it.
    process.env.SHOWBOOK_LLM_DAILY_BUDGET_USD = '0.000001';
    const crossing = await meterLLMSpend('openai/gpt-oss-120b', {
      promptTokens: 100_000,
      completionTokens: 100_000,
    });
    assert.ok(crossing);
    assert.equal(crossing.within, false);

    await assert.rejects(
      () => enforceLLMBudget(),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );

    // The cap is read per call: a raised budget un-trips the gate without any
    // reset — the counter did not change, the ceiling did. (Also restores a
    // sane state for any test that runs after this one.)
    process.env.SHOWBOOK_LLM_DAILY_BUDGET_USD = '10000';
    await enforceLLMBudget();

    // Metering past the line again under the huge budget: not crossed.
    const after = await meterLLMSpend('openai/gpt-oss-120b', { promptTokens: 1 });
    assert.ok(after);
    assert.equal(after.crossed, false);
  });

  it('tolerates absent usage (a completion with no usage block meters zero)', async () => {
    const result = await meterLLMSpend('openai/gpt-oss-120b', undefined);
    assert.ok(result);
  });
});

describe('isItunesLookupLimited', () => {
  it('is deployment-wide: the cap is shared, not per user', async () => {
    // Apple throttles per IP, and this deployment is one IP. Drain the global
    // minute bucket and every caller — any user — is limited.
    process.env.SHOWBOOK_ITUNES_LOOKUPS_PER_MINUTE = '3';
    let limitedAt = -1;
    for (let i = 0; i < 5; i++) {
      if (await isItunesLookupLimited()) {
        limitedAt = i;
        break;
      }
    }
    assert.equal(limitedAt, 3, 'the 4th lookup in the minute must be shed');
    assert.equal(await isItunesLookupLimited(), true, 'and it stays shed');
  });
});
