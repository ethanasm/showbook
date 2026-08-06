/**
 * Unit tests for the rate-limit / LLM-quota guards on the enrichment
 * router. We exhaust the underlying token bucket directly (rate-limit.ts
 * exports a Map-backed `enforceRateLimit` keyed by `<gate>:<userId>`)
 * and then assert the router throws TOO_MANY_REQUESTS without ever
 * reaching the network. This avoids 60+ real fetches per test.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TRPCError } from '@trpc/server';
import { enrichmentRouter } from '../routers/enrichment';
import { enforceRateLimit } from '../rate-limit';
import { enforceBulkScanRateLimit, enforceLLMQuota } from '../llm-quota';
import { fakeCtx, makeFakeDb } from './_fake-db';

const USER_ID = 'rate-limit-user';

function caller(userId = USER_ID) {
  return enrichmentRouter.createCaller(fakeCtx(makeFakeDb(), userId) as never);
}

function exhaustBucket(key: string, max: number, windowMs: number) {
  for (let i = 0; i < max; i++) enforceRateLimit(key, { max, windowMs });
}

// The LLM and bulk-scan quotas moved off the rate-limit Map onto the durable
// budget governor (llm-quota.ts → budget.ts), so they are exhausted through
// the real enforcement path rather than by poking the old bucket key.
async function exhaustLLMQuota(userId: string, calls = 50) {
  for (let i = 0; i < calls; i++) await enforceLLMQuota(userId);
}

async function exhaustBulkScanQuota(userId: string, calls = 5) {
  for (let i = 0; i < calls; i++) await enforceBulkScanRateLimit(userId);
}

beforeEach(() => {
  // Each test uses a unique userId suffix so buckets don't bleed across
  // cases. Re-importing rate-limit via a cache-buster is unnecessary
  // since the per-user keys are scoped.
});

describe('enrichmentRouter rate limits', () => {
  it('searchTM throws TOO_MANY_REQUESTS once the bucket is exhausted', async () => {
    const userId = `${USER_ID}-tm`;
    exhaustBucket(`searchTM:${userId}`, 60, 60_000);
    await assert.rejects(
      () =>
        caller(userId).searchTM({
          headliner: 'whatever',
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('fetchTMEventByUrl throws TOO_MANY_REQUESTS when bucket is full', async () => {
    const userId = `${USER_ID}-tmurl`;
    exhaustBucket(`fetchTMEventByUrl:${userId}`, 60, 60_000);
    await assert.rejects(
      () =>
        caller(userId).fetchTMEventByUrl({
          url: 'https://example.com/event/abc',
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('fetchSetlist throws TOO_MANY_REQUESTS when bucket is full', async () => {
    const userId = `${USER_ID}-setlist`;
    exhaustBucket(`fetchSetlist:${userId}`, 30, 60_000);
    await assert.rejects(
      () =>
        caller(userId).fetchSetlist({
          performerName: 'X',
          date: '2026-01-01',
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('searchPlaces throws TOO_MANY_REQUESTS when bucket is full', async () => {
    const userId = `${USER_ID}-places`;
    exhaustBucket(`searchPlaces:${userId}`, 30, 60_000);
    await assert.rejects(
      () => caller(userId).searchPlaces({ query: 'foo' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('placeDetails throws TOO_MANY_REQUESTS when bucket is full', async () => {
    const userId = `${USER_ID}-place-details`;
    exhaustBucket(`placeDetails:${userId}`, 30, 60_000);
    await assert.rejects(
      () => caller(userId).placeDetails({ placeId: 'p1' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });
});

describe('enrichmentRouter LLM quota', () => {
  // Quota state is per (user, UTC day) in the budget governor, so each test
  // burns its own distinct user's allowance through the real path.
  it('parseChat rejects once the daily LLM quota is exhausted', async () => {
    const userId = `${USER_ID}-llm-parse`;
    await exhaustLLMQuota(userId);
    await assert.rejects(
      () => caller(userId).parseChat({ freeText: 'some show' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('extractCast rejects once the daily LLM quota is exhausted', async () => {
    const userId = `${USER_ID}-llm-cast`;
    await exhaustLLMQuota(userId);
    await assert.rejects(
      () => caller(userId).extractCast({ imageBase64: '/9j/abc' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('extractFromPdf rejects once the daily LLM quota is exhausted', async () => {
    const userId = `${USER_ID}-llm-pdf`;
    await exhaustLLMQuota(userId);
    await assert.rejects(
      () => caller(userId).extractFromPdf({ fileBase64: 'abc' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('scanGmailForShow rejects once the daily LLM quota is exhausted', async () => {
    const userId = `${USER_ID}-llm-gmail-one`;
    await exhaustLLMQuota(userId);
    await assert.rejects(
      () =>
        caller(userId).scanGmailForShow({
          accessToken: 'token',
          headliner: 'X',
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('gmailProcessBatch rejects once the daily LLM quota is exhausted', async () => {
    const userId = `${USER_ID}-llm-gmail-batch`;
    await exhaustLLMQuota(userId);
    await assert.rejects(
      () =>
        caller(userId).gmailProcessBatch({
          accessToken: 'token',
          messageIds: ['m1', 'm2'],
        }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('gmailProcessBatch caps messageIds at 50 via input schema', async () => {
    const userId = `${USER_ID}-batch-cap`;
    const messageIds = Array.from({ length: 51 }, (_, i) => `m${i}`);
    await assert.rejects(
      () => caller(userId).gmailProcessBatch({ accessToken: 't', messageIds }),
      // zod validation error surfaces as BAD_REQUEST through tRPC
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'BAD_REQUEST',
    );
  });
});

describe('enrichmentRouter bulk-scan rate limits', () => {
  it('bulkScanGmail rejects once the per-hour bucket is exhausted', async () => {
    const userId = `${USER_ID}-bulk`;
    await exhaustBulkScanQuota(userId);
    await assert.rejects(
      () => caller(userId).bulkScanGmail({ accessToken: 'token' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });

  it('gmailCollectMessages rejects once the per-hour bucket is exhausted', async () => {
    const userId = `${USER_ID}-collect`;
    await exhaustBulkScanQuota(userId);
    await assert.rejects(
      () => caller(userId).gmailCollectMessages({ accessToken: 'token' }),
      (err: unknown) =>
        err instanceof TRPCError && err.code === 'TOO_MANY_REQUESTS',
    );
  });
});
