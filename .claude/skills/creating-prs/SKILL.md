---
name: creating-prs
description: Use after committing changes that need to ship. Pushes the branch, opens the PR via the GitHub MCP tools, subscribes to PR activity so CI failures stream back, and (when the diff touches UI) hands off to the pr-screenshots skill so the PR description gets visual review material inline.
---

# Creating PRs

## Overview

The `bug-fixing`, refactor, and feature loops all end the same way: push,
open a PR, watch CI. This skill owns that tail so other skills can delegate
instead of re-implementing it. It also decides whether the PR needs visual
review material attached (web Playwright screenshots, mobile Maestro Cloud
screenshots) and triggers the `pr-screenshots` skill if so.

## When to use

- A caller skill (`bug-fixing`, future refactor/feature skills) hands off
  after `pnpm verify` is green and the change is committed locally.
- The user asks "open a PR" or "ship this".

## When NOT to use

- The change is still WIP and the user hasn't asked to push it.
- A PR already exists for this branch — re-push and let the existing
  subscription stream new CI events instead.

## Loop

### 1. Merge latest `main` into the branch

Before pushing, fetch and merge the current `origin/main` into the
working branch so the PR is reviewed against (and CI runs against) an
up-to-date base — and so we catch interaction conflicts locally
instead of in CI:

```
git fetch origin main
git merge origin/main --no-edit
```

If `git merge` reports conflicts, resolve them, re-stage, and commit
the merge before continuing. If the merge pulls in meaningful changes
(non-trivial diff outside the branch's own files), re-run
`pnpm verify` so the local gate still reflects what's about to ship.

The web sandbox checkout is a shallow clone — `git fetch origin main`
brings in just the commits needed for the merge base. Don't
`git fetch --unshallow`; don't rebase onto main; don't merge from a
non-`origin` remote.

### 2. Push the branch

```
git push -u origin <branch>
```

If the push fails on a network error, retry up to 4× with exponential
backoff (2s, 4s, 8s, 16s). Don't retry on non-network failures — debug
those first.

### 3. Open the PR

Use `mcp__github__create_pull_request`. Constraints:

- Title is a **conventional commit** — `type(scope)?: imperative
  summary`, under 70 chars; details go in the body. The squash-merged
  title is what `mobile-deploy.yml`'s version-bump scan reads, so the
  type drives the mobile app's version at the next native build:
  `feat:` → MINOR bump (use it for any user-visible feature —
  under-typing a feature loses the release signal, over-typing
  inflates the version); `fix:` / `docs:` / `chore:` / `ci:` /
  `refactor:` / `perf:` / `test:` → patch; a breaking `!` (`feat!:`)
  → major, mapped to minor pre-1.0. Full case table in repo-root
  `CLAUDE.md` → "Commit and PR hygiene"; scheme rationale in
  `docs/specs/decisions.md` D25.
- Body has `## Summary` (1–3 bullets) and `## Test plan` (markdown
  checklist). No `https://claude.ai/code/session_…` footer, no
  `Co-authored-by: Claude` trailer, no "Generated with Claude Code"
  line — see repo-root `CLAUDE.md` → "Commit and PR hygiene".

Tell the user the PR URL as soon as it's created.

### 4. Attach visual review material if the diff touches UI

Run `git diff --name-only main...HEAD` (or against the PR base) and
match against:

- **Web UI**: `apps/web/app/**`, `apps/web/components/**`,
  `apps/web/lib/**/*.tsx`
- **Mobile UI**: `apps/mobile/app/**`, `apps/mobile/components/**`

If anything matches, invoke the `pr-screenshots` skill and pass it the
PR number and the matched scope (`web`, `mobile`, or both). It handles
capture + hosting + PR-body update. If nothing matches, skip.

### 5. Peer-review the PR with an Opus subagent

Once the PR is open, spawn a **subagent on the Opus model**
(`Agent` with `model: "opus"`) to peer-review the diff and **post its
findings as a single PR comment**. This is a fresh-eyes review of the
shipped change, separate from any local `/code-review` you ran while
writing it. Run it in the background (`run_in_background: true`) so CI
and the rest of the loop proceed in parallel; fold its findings in when
it returns.

Give the subagent:

- the PR number + repo (`ethanasm/showbook`) and that the branch is
  checked out locally, so it can read the diff via
  `mcp__github__pull_request_read` (method `get_diff`) **and** the full
  files locally for context;
- a short description of what the change does and the riskiest areas to
  scrutinize (job/retry semantics, migrations + FK/cascade behavior,
  query correctness, cross-surface parity, edge/empty/error states,
  test coverage of the key invariants) — correctness and robustness,
  not style nits;
- the deliverable: a structured verdict (approve / approve-with-nits /
  request-changes) plus findings grouped by severity (P0 / P1 / P2),
  each with a `file:line` reference and a concrete recommendation;
- instructions to **post the review as ONE consolidated comment** via
  `mcp__github__add_issue_comment` (prefixed `## Peer review
  (automated)`), to **not** post multiple comments, and to **not**
  modify any code. (Posting a review comment is the point of this step,
  so the external-write is intended — note that to the user when you
  relay results.)

When it returns, **you (the main agent) own the findings**: fix every
P0 and P1, and fix P2s at your discretion (lean toward fixing). Re-run
the relevant non-E2E gate and push. Surface anything you're
deliberately not fixing (with the reason) to the user rather than
dropping it silently.

### 6. Subscribe to CI activity

```
mcp__github__subscribe_pr_activity { owner: "ethanasm", repo: "showbook", pullNumber: <n> }
```

Events arrive wrapped in `<github-webhook-activity>` tags. While CI
runs you can move on to other work.

### 7. React to events

When a failure event arrives:

1. Pull the failing job's logs via the GitHub MCP tools and identify
   the failing test plus its assertion or stack frame.
2. Decide if it's a real regression in the diff, a pre-existing flake,
   or an environment issue. For E2E flakes, check the test for known
   flaky patterns before retrying.
3. If it's a real failure, fix it locally, re-run the relevant
   **non-E2E** gate (per `bug-fixing`'s "Why no local E2E"), and push.
   CI re-runs automatically.
4. Repeat until CI is green. Unsubscribe with
   `mcp__github__unsubscribe_pr_activity` once the PR is merged or
   the user releases you.

For review-comment events (someone left a code-review comment), use
your judgement: if the suggestion is clear and not architecturally
significant, apply it; if it's ambiguous, ask the user before acting.

## Anti-patterns

- Pushing to `main` directly — always go through a PR.
- Force-pushing to a PR branch without telling the user.
- Skipping the PR-body screenshots section on UI changes — reviewers
  shouldn't have to pull the branch to see what changed visually.
- Using `--no-verify` to bypass a failing pre-commit hook — fix the
  underlying issue.
