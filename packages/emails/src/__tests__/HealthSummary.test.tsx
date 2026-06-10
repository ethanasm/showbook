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

  it('renders the CI Health section with per-job detail', async () => {
    const html = await renderHealthSummary({
      ...baseProps,
      status: 'fail',
      checks: [
        { name: 'database', status: 'ok', summary: 'Postgres reachable' },
        {
          name: 'ci_health',
          status: 'fail',
          summary: '1/2 CI workflows failing on main: Deploy',
          detail: {
            ci: {
              repo: 'ethanasm/showbook',
              branch: 'main',
              runs: [
                {
                  workflowName: 'CI',
                  runNumber: 42,
                  status: 'completed',
                  conclusion: 'success',
                  branch: 'main',
                  commitSha: 'abc1234',
                  title: 'fix things',
                  url: 'https://github.com/o/r/actions/runs/101',
                  jobs: [
                    { name: 'build', status: 'completed', conclusion: 'success', url: null },
                    { name: 'e2e', status: 'completed', conclusion: 'success', url: null },
                  ],
                },
                {
                  workflowName: 'Deploy',
                  runNumber: 7,
                  status: 'completed',
                  conclusion: 'failure',
                  branch: 'main',
                  commitSha: 'def5678',
                  title: 'deploy prod',
                  url: 'https://github.com/o/r/actions/runs/200',
                  jobs: [
                    { name: 'deploy', status: 'completed', conclusion: 'failure', url: null },
                  ],
                },
              ],
            },
          },
        },
      ],
    });
    assert.match(html, /CI Health/);
    // Per-workflow names and per-job names both render.
    assert.match(html, /Deploy/);
    assert.match(html, />\s*build\s*</);
    assert.match(html, />\s*e2e\s*</);
    assert.match(html, />\s*deploy\s*</);
    // Hero headline counts CI as a failure even though it's rendered in
    // its own section rather than the generic Failing bucket.
    assert.match(html, /1 failing/);
  });

  it('renders the CI section even when the detail payload is missing', async () => {
    const html = await renderHealthSummary({
      ...baseProps,
      status: 'warn',
      checks: [
        {
          name: 'ci_health',
          status: 'warn',
          summary: 'GitHub API query failed: github http 500',
        },
      ],
    });
    assert.match(html, /CI Health/);
    assert.match(html, /github http 500/);
  });
});
