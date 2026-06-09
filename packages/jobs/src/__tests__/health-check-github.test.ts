/**
 * Unit tests for the GitHub Actions CI-health helper and check. We mock
 * `fetch` so the test runs offline and doesn't need a real token.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

import { fetchCiHealth, getConfig } from '../health-check/github';
import { checkCiHealth } from '../health-check/checks';
import type { CiHealthResult } from '../health-check/github';

const ORIGINAL_FETCH = globalThis.fetch;

function installFetch(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
) {
  globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
    return handler(typeof url === 'string' ? url : url.toString(), init ?? {});
  }) as unknown as typeof fetch;
}

function runsPayload() {
  return {
    workflow_runs: [
      // CI workflow — newest first; an older CI run follows to prove we
      // only keep the latest per workflow.
      {
        id: 101,
        name: 'CI',
        workflow_id: 1,
        head_branch: 'main',
        head_sha: 'abcdef1234567890',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        run_number: 42,
        created_at: '2026-06-04T07:00:00Z',
        html_url: 'https://github.com/o/r/actions/runs/101',
        display_title: 'fix: something',
      },
      {
        id: 100,
        name: 'CI',
        workflow_id: 1,
        head_branch: 'main',
        head_sha: 'old',
        event: 'push',
        status: 'completed',
        conclusion: 'failure',
        run_number: 41,
        created_at: '2026-06-03T07:00:00Z',
        html_url: 'https://github.com/o/r/actions/runs/100',
        display_title: 'old run',
      },
      {
        id: 200,
        name: 'Deploy',
        workflow_id: 2,
        head_branch: 'main',
        head_sha: 'deadbeefcafef00d',
        event: 'push',
        status: 'completed',
        conclusion: 'failure',
        run_number: 7,
        created_at: '2026-06-04T07:05:00Z',
        html_url: 'https://github.com/o/r/actions/runs/200',
        display_title: 'deploy prod',
      },
    ],
  };
}

function jobsPayload(runId: string) {
  if (runId === '101') {
    return {
      jobs: [
        {
          name: 'build',
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-06-04T07:00:00Z',
          completed_at: '2026-06-04T07:05:00Z',
          html_url: 'https://github.com/o/r/actions/runs/101/job/1',
        },
        {
          name: 'e2e',
          status: 'completed',
          conclusion: 'success',
          started_at: '2026-06-04T07:05:00Z',
          completed_at: '2026-06-04T07:20:00Z',
          html_url: 'https://github.com/o/r/actions/runs/101/job/2',
        },
      ],
    };
  }
  return {
    jobs: [
      {
        name: 'deploy',
        status: 'completed',
        conclusion: 'failure',
        started_at: '2026-06-04T07:05:00Z',
        completed_at: '2026-06-04T07:06:00Z',
        html_url: 'https://github.com/o/r/actions/runs/200/job/1',
      },
    ],
  };
}

beforeEach(() => {
  delete process.env.GITHUB_HEALTH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_HEALTH_REPO;
  delete process.env.GITHUB_HEALTH_BRANCH;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('getConfig', () => {
  it('splits owner/repo and applies defaults', () => {
    const cfg = getConfig();
    assert.equal(cfg.owner, 'ethanasm');
    assert.equal(cfg.repo, 'showbook');
    assert.equal(cfg.branch, 'main');
    assert.equal(cfg.token, null);
  });

  it('prefers GITHUB_HEALTH_TOKEN, then falls back to GITHUB_TOKEN', () => {
    process.env.GITHUB_TOKEN = 'fallback';
    assert.equal(getConfig().token, 'fallback');
    process.env.GITHUB_HEALTH_TOKEN = 'preferred';
    assert.equal(getConfig().token, 'preferred');
  });

  it('reads repo + branch overrides from env', () => {
    process.env.GITHUB_HEALTH_REPO = 'someone/else';
    process.env.GITHUB_HEALTH_BRANCH = 'develop';
    const cfg = getConfig();
    assert.equal(cfg.owner, 'someone');
    assert.equal(cfg.repo, 'else');
    assert.equal(cfg.branch, 'develop');
  });
});

describe('fetchCiHealth', () => {
  it('skips when no token is configured', async () => {
    let called = false;
    installFetch(() => {
      called = true;
      return new Response('{}', { status: 200 });
    });
    const res = await fetchCiHealth();
    assert.equal(res.skipped, true);
    assert.equal(res.ok, false);
    assert.equal(res.data, null);
    assert.equal(called, false);
  });

  it('returns the latest run per workflow with per-job detail', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    const calls: string[] = [];
    installFetch((url) => {
      calls.push(url);
      if (url.includes('/actions/runs?')) {
        return new Response(JSON.stringify(runsPayload()), { status: 200 });
      }
      const m = url.match(/\/actions\/runs\/(\d+)\/jobs/);
      if (m) {
        return new Response(JSON.stringify(jobsPayload(m[1]!)), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });

    const res = await fetchCiHealth();
    assert.equal(res.ok, true);
    assert.equal(res.skipped, false);
    assert.ok(res.data);
    // Two workflows (CI, Deploy), sorted by name, latest run only.
    assert.deepEqual(
      res.data!.runs.map((r) => r.workflowName),
      ['CI', 'Deploy'],
    );
    const ci = res.data!.runs[0]!;
    assert.equal(ci.runNumber, 42); // latest, not the older failed run
    assert.equal(ci.conclusion, 'success');
    assert.equal(ci.commitSha, 'abcdef1'); // 7-char short sha
    assert.deepEqual(
      ci.jobs.map((j) => j.name),
      ['build', 'e2e'],
    );
    // The Deploy run's authenticated headers were sent.
    const lastInit = (globalThis.fetch as unknown as { mock: { calls: { arguments: unknown[] }[] } }).mock.calls[0]!
      .arguments[1] as RequestInit;
    const headers = lastInit.headers as Record<string, string>;
    assert.equal(headers['Authorization'], 'Bearer tok');
    assert.match(headers['Accept'] ?? '', /github/);
  });

  it('reports an http error on the runs call without throwing', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    installFetch(() => new Response('forbidden', { status: 403 }));
    const res = await fetchCiHealth();
    assert.equal(res.ok, false);
    assert.equal(res.skipped, false);
    assert.equal(res.data, null);
    assert.match(res.error ?? '', /403/);
  });

  it('degrades a failed jobs call to an empty job list', async () => {
    process.env.GITHUB_TOKEN = 'tok';
    installFetch((url) => {
      if (url.includes('/actions/runs?')) {
        return new Response(
          JSON.stringify({ workflow_runs: [runsPayload().workflow_runs[0]] }),
          { status: 200 },
        );
      }
      return new Response('boom', { status: 500 });
    });
    const res = await fetchCiHealth();
    assert.equal(res.ok, true);
    assert.equal(res.data!.runs.length, 1);
    assert.deepEqual(res.data!.runs[0]!.jobs, []);
  });
});

describe('checkCiHealth', () => {
  function fakeFetch(result: CiHealthResult): () => Promise<CiHealthResult> {
    return async () => result;
  }

  it('returns unknown when the fetch was skipped (no token)', async () => {
    const check = await checkCiHealth(fakeFetch({ ok: false, skipped: true, data: null }));
    assert.equal(check.name, 'ci_health');
    assert.equal(check.status, 'unknown');
    assert.match(check.summary, /unset/);
  });

  it('warns when the GitHub API call failed', async () => {
    const check = await checkCiHealth(
      fakeFetch({ ok: false, skipped: false, data: null, error: 'github http 500' }),
    );
    assert.equal(check.status, 'warn');
    assert.match(check.summary, /500/);
  });

  it('is ok when every workflow is green', async () => {
    const check = await checkCiHealth(
      fakeFetch({
        ok: true,
        skipped: false,
        data: {
          repo: 'o/r',
          branch: 'main',
          runs: [
            {
              workflowName: 'CI',
              runNumber: 1,
              status: 'completed',
              conclusion: 'success',
              branch: 'main',
              event: 'push',
              commitSha: 'abc1234',
              title: 't',
              createdAt: null,
              url: null,
              jobs: [],
            },
          ],
        },
      }),
    );
    assert.equal(check.status, 'ok');
    assert.match(check.summary, /green on main/);
    assert.ok(check.detail?.ci);
  });

  it('fails when any workflow concluded failure', async () => {
    const check = await checkCiHealth(
      fakeFetch({
        ok: true,
        skipped: false,
        data: {
          repo: 'o/r',
          branch: 'main',
          runs: [
            {
              workflowName: 'CI',
              runNumber: 2,
              status: 'completed',
              conclusion: 'success',
              branch: 'main',
              event: 'push',
              commitSha: null,
              title: null,
              createdAt: null,
              url: null,
              jobs: [],
            },
            {
              workflowName: 'Deploy',
              runNumber: 3,
              status: 'completed',
              conclusion: 'failure',
              branch: 'main',
              event: 'push',
              commitSha: null,
              title: null,
              createdAt: null,
              url: null,
              jobs: [],
            },
          ],
        },
      }),
    );
    assert.equal(check.status, 'fail');
    assert.match(check.summary, /Deploy/);
  });

  it('treats an in-progress run as not failing', async () => {
    const check = await checkCiHealth(
      fakeFetch({
        ok: true,
        skipped: false,
        data: {
          repo: 'o/r',
          branch: 'main',
          runs: [
            {
              workflowName: 'CI',
              runNumber: 4,
              status: 'in_progress',
              conclusion: null,
              branch: 'main',
              event: 'push',
              commitSha: null,
              title: null,
              createdAt: null,
              url: null,
              jobs: [],
            },
          ],
        },
      }),
    );
    assert.equal(check.status, 'ok');
  });

  it('warns when no runs were found', async () => {
    const check = await checkCiHealth(
      fakeFetch({
        ok: true,
        skipped: false,
        data: { repo: 'o/r', branch: 'main', runs: [] },
      }),
    );
    assert.equal(check.status, 'warn');
    assert.match(check.summary, /No CI runs/);
  });
});
