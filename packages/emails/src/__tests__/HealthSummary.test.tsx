import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderHealthSummary } from '../render';
import type { HealthSummaryProps } from '../HealthSummary';

const APP = 'https://showbook.example';
const RUN_AT = new Date('2026-05-03T11:00:00Z');

const baseProps: HealthSummaryProps = {
  status: 'ok',
  runAt: RUN_AT,
  appUrl: APP,
  checks: [
    { name: 'database', status: 'ok', summary: 'Postgres reachable' },
    { name: 'pgboss_queue', status: 'ok', summary: 'Queue healthy' },
  ],
};

describe('renderHealthSummary', () => {
  it('renders OK summary with passing checks', async () => {
    const html = await renderHealthSummary(baseProps);
    assert.match(html, /<html[^>]*>/i);
    assert.match(html, /Showbook/);
    assert.match(html, /Postgres reachable/);
    assert.match(html, /Queue healthy/);
  });

  it('shows failing section when checks fail', async () => {
    const html = await renderHealthSummary({
      ...baseProps,
      status: 'fail',
      checks: [
        {
          name: 'database',
          status: 'fail',
          summary: 'Postgres unreachable: ECONNREFUSED',
          detail: { error: 'ECONNREFUSED' },
        },
        { name: 'pgboss_queue', status: 'ok', summary: 'Queue healthy' },
      ],
    });
    assert.match(html, /Failing/);
    assert.match(html, /unreachable/);
    assert.match(html, /Passing/);
  });

  it('shows unknown section when Axiom checks were skipped', async () => {
    const html = await renderHealthSummary({
      ...baseProps,
      status: 'unknown',
      checks: [
        { name: 'failed_jobs', status: 'unknown', summary: 'Axiom query token unset — skipped' },
        { name: 'database', status: 'ok', summary: 'Postgres reachable' },
      ],
    });
    assert.match(html, /Unknown/);
    assert.match(html, /token unset/);
  });

  it('renders detail JSON inline when small enough', async () => {
    const html = await renderHealthSummary({
      ...baseProps,
      checks: [
        {
          name: 'failed_jobs',
          status: 'fail',
          summary: '2 job failures in last 24h',
          detail: { failures: [{ job: 'shows/nightly', jobId: 'a' }] },
        },
      ],
      status: 'fail',
    });
    assert.match(html, /shows\/nightly/);
  });

  it('renders LLM preamble paragraphs when provided', async () => {
    const html = await renderHealthSummary({
      ...baseProps,
      preamble:
        'shows/nightly failed twice overnight; check job.failed events.\n\nQueue is healthy otherwise.',
    });
    assert.match(html, /shows\/nightly failed twice/);
    assert.match(html, /Queue is healthy otherwise/);
  });

  it('falls back to count line when preamble is null', async () => {
    const html = await renderHealthSummary({ ...baseProps, preamble: null });
    assert.match(html, /checks passing/);
  });
});
