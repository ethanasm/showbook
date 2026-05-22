/**
 * Unit tests for the admin-section toast-summary formatters.
 *
 * Pure functions, no RN/Expo deps — runs clean in node:test. The
 * AdminSection component that consumes them is outside the mobile
 * coverage gate, so these tests are what keep the operator-facing
 * wording honest.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatJobEnqueued,
  formatVenueBackfill,
  formatSetlistRetry,
  formatCorpusFill,
} from '../admin-actions.js';

describe('formatJobEnqueued', () => {
  it('reports a fresh enqueue when a job id is returned', () => {
    assert.equal(
      formatJobEnqueued('job-abc'),
      'Job enqueued — it runs in the background',
    );
  });

  it('reports a dedup when the server returns a null job id', () => {
    assert.equal(
      formatJobEnqueued(null),
      'Already queued — no new job was created',
    );
  });

  it('treats an undefined job id as a dedup', () => {
    assert.equal(
      formatJobEnqueued(undefined),
      'Already queued — no new job was created',
    );
  });
});

describe('formatVenueBackfill', () => {
  it('reports the empty case when nothing needed backfilling', () => {
    assert.equal(
      formatVenueBackfill('Geocoded', 0, 0, 0),
      'Nothing to backfill — every venue is already complete',
    );
  });

  it('omits the failed segment when there were no failures', () => {
    assert.equal(
      formatVenueBackfill('Geocoded', 12, 0, 12),
      'Geocoded 12 · 12 total',
    );
  });

  it('includes the failed segment when some rows failed', () => {
    assert.equal(
      formatVenueBackfill('Matched', 8, 2, 10),
      'Matched 8 · 2 failed · 10 total',
    );
  });
});

describe('formatSetlistRetry', () => {
  it('reports the empty case even when a retry job started', () => {
    assert.equal(
      formatSetlistRetry(0, 'job-1'),
      'No new shows needed queueing · retry job started',
    );
  });

  it('uses the singular noun for a single queued show', () => {
    assert.equal(
      formatSetlistRetry(1, 'job-1'),
      'Queued 1 show · retry job started',
    );
  });

  it('uses the plural noun and omits the job suffix when no job id', () => {
    assert.equal(formatSetlistRetry(5, null), 'Queued 5 shows');
  });
});

describe('formatCorpusFill', () => {
  it('reports a plain enqueue when the performer has an MBID', () => {
    assert.equal(
      formatCorpusFill('Phoebe Bridgers', true),
      'Corpus fill enqueued for Phoebe Bridgers',
    );
  });

  it('warns about the short-circuit when the performer has no MBID', () => {
    assert.equal(
      formatCorpusFill('The Local Opener', false),
      'Corpus fill enqueued for The Local Opener — no MBID on file, the job will short-circuit',
    );
  });
});
