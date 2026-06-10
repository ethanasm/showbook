import { child } from '@showbook/observability';

const log = child({ component: 'health-check.github' });

const API_BASE = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REPO = 'ethanasm/showbook';
const DEFAULT_BRANCH = 'main';
/** Cap the number of workflows we drill into so a repo with many rarely
 *  used workflows can't fan the daily check out into dozens of API calls. */
const MAX_WORKFLOWS = 12;

export interface GitHubConfig {
  /** Read token with `actions:read`. Defaults to `GITHUB_HEALTH_TOKEN`
   *  then `GITHUB_TOKEN`. */
  token?: string;
  /** `owner/repo`. Defaults to `GITHUB_HEALTH_REPO` then `ethanasm/showbook`. */
  repo?: string;
  /** Branch whose CI health we report. Defaults to `GITHUB_HEALTH_BRANCH`
   *  then `main` — the morning check cares about trunk health, not the
   *  noise of in-flight PR runs. */
  branch?: string;
}

/**
 * One GitHub Actions job inside a workflow run. Mirrors the subset of the
 * `/runs/{id}/jobs` payload the email renders. `conclusion` is null while
 * the job is still queued / in progress.
 */
export interface CiJob {
  name: string;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
}

/**
 * The most recent run of a single workflow on the configured branch, with
 * its per-job breakdown. `conclusion` is null while the run is still
 * executing (`status !== 'completed'`).
 */
export interface CiWorkflowRun {
  workflowName: string;
  runNumber: number | null;
  status: string;
  conclusion: string | null;
  branch: string | null;
  event: string | null;
  commitSha: string | null;
  title: string | null;
  createdAt: string | null;
  url: string | null;
  jobs: CiJob[];
}

export interface CiHealthData {
  repo: string;
  branch: string;
  runs: CiWorkflowRun[];
}

export interface CiHealthResult {
  /** True when GitHub was reachable and the runs were parsed. */
  ok: boolean;
  /** True when no token was configured, so the check should render
   *  "unknown" rather than "ok" (mirrors the Axiom skip semantics). */
  skipped: boolean;
  data: CiHealthData | null;
  error?: string;
}

/** Injection seam so `checkCiHealth` can be tested without the network. */
export type FetchCiHealthFn = typeof fetchCiHealth;

export function getConfig(cfg?: GitHubConfig): {
  token: string | null;
  owner: string;
  repo: string;
  branch: string;
} {
  const repoFull =
    cfg?.repo ?? process.env.GITHUB_HEALTH_REPO ?? DEFAULT_REPO;
  const slash = repoFull.indexOf('/');
  const owner = slash > 0 ? repoFull.slice(0, slash) : repoFull;
  const repo = slash > 0 ? repoFull.slice(slash + 1) : '';
  return {
    token:
      cfg?.token ??
      process.env.GITHUB_HEALTH_TOKEN ??
      process.env.GITHUB_TOKEN ??
      null,
    owner,
    repo,
    branch: cfg?.branch ?? process.env.GITHUB_HEALTH_BRANCH ?? DEFAULT_BRANCH,
  };
}

interface RunsResponse {
  workflow_runs?: Array<{
    id?: number;
    name?: string | null;
    workflow_id?: number;
    head_branch?: string | null;
    head_sha?: string | null;
    event?: string | null;
    status?: string | null;
    conclusion?: string | null;
    run_number?: number | null;
    created_at?: string | null;
    html_url?: string | null;
    display_title?: string | null;
  }>;
}

interface JobsResponse {
  jobs?: Array<{
    name?: string | null;
    status?: string | null;
    conclusion?: string | null;
    started_at?: string | null;
    completed_at?: string | null;
    html_url?: string | null;
  }>;
}

async function ghFetch<T>(
  path: string,
  token: string,
): Promise<{ ok: boolean; body: T | null; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'showbook-health-check',
      },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const error = `github http ${res.status}: ${text.slice(0, 200)}`;
      log.warn(
        { event: 'health.check.ci.http_error', status: res.status, path },
        error,
      );
      return { ok: false, body: null, error };
    }
    return { ok: true, body: (await res.json()) as T };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.warn({ event: 'health.check.ci.failed', err, path }, 'GitHub API call failed');
    return { ok: false, body: null, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the latest run of each workflow on the configured branch and its
 * per-job breakdown. Returns `skipped` when no token is configured (dev,
 * tests) so the check renders "unknown". Never throws — failures surface
 * through `ok: false` + `error`.
 */
export async function fetchCiHealth(cfg?: GitHubConfig): Promise<CiHealthResult> {
  const { token, owner, repo, branch } = getConfig(cfg);

  if (!token) {
    log.debug(
      { event: 'health.check.ci.skipped' },
      'GITHUB_HEALTH_TOKEN/GITHUB_TOKEN unset; skipping CI check',
    );
    return { ok: false, skipped: true, data: null };
  }
  if (!owner || !repo) {
    return {
      ok: false,
      skipped: false,
      data: null,
      error: `invalid repo "${owner}/${repo}" (expected owner/repo)`,
    };
  }

  // One call gets the recent run history for the branch (newest first);
  // `exclude_pull_requests` keeps it to trunk pushes/schedules so PR noise
  // doesn't crowd out the workflow we actually want.
  const runsPath =
    `/repos/${owner}/${repo}/actions/runs` +
    `?branch=${encodeURIComponent(branch)}&exclude_pull_requests=true&per_page=50`;
  const runsRes = await ghFetch<RunsResponse>(runsPath, token);
  if (!runsRes.ok || !runsRes.body) {
    return { ok: false, skipped: false, data: null, error: runsRes.error };
  }

  // Group by workflow, keeping the newest run per workflow (the API
  // returns newest first, so the first occurrence wins).
  const latestByWorkflow = new Map<
    number,
    NonNullable<RunsResponse['workflow_runs']>[number]
  >();
  for (const run of runsRes.body.workflow_runs ?? []) {
    const wfId = run.workflow_id;
    if (wfId === undefined) continue;
    if (!latestByWorkflow.has(wfId)) latestByWorkflow.set(wfId, run);
  }

  const selected = [...latestByWorkflow.values()]
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, MAX_WORKFLOWS);

  // Fetch each selected run's jobs in parallel. A jobs call that fails
  // degrades to an empty job list rather than failing the whole check —
  // the run-level conclusion is still useful on its own.
  const runs: CiWorkflowRun[] = await Promise.all(
    selected.map(async (run) => {
      let jobs: CiJob[] = [];
      if (run.id !== undefined) {
        const jobsRes = await ghFetch<JobsResponse>(
          `/repos/${owner}/${repo}/actions/runs/${run.id}/jobs?per_page=50`,
          token,
        );
        if (jobsRes.ok && jobsRes.body) {
          jobs = (jobsRes.body.jobs ?? []).map((j) => ({
            name: j.name ?? '(unnamed)',
            status: j.status ?? 'unknown',
            conclusion: j.conclusion ?? null,
            startedAt: j.started_at ?? null,
            completedAt: j.completed_at ?? null,
            url: j.html_url ?? null,
          }));
        }
      }
      return {
        workflowName: run.name ?? '(unnamed workflow)',
        runNumber: run.run_number ?? null,
        status: run.status ?? 'unknown',
        conclusion: run.conclusion ?? null,
        branch: run.head_branch ?? null,
        event: run.event ?? null,
        commitSha: run.head_sha ? run.head_sha.slice(0, 7) : null,
        title: run.display_title ?? null,
        createdAt: run.created_at ?? null,
        url: run.html_url ?? null,
        jobs,
      };
    }),
  );

  return {
    ok: true,
    skipped: false,
    data: { repo: `${owner}/${repo}`, branch, runs },
  };
}
