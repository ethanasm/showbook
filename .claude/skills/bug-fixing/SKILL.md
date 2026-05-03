---
name: bug-fixing
description: Use when fixing a bug in the showbook codebase. Verifies locally without running E2E (which is slow/flaky in the sandbox), then opens a PR and subscribes to CI activity so E2E failures from GitHub Actions can be triaged and patched in-loop.
---

# Bug fixing

## Overview

E2E (Playwright) is expensive to run in the local/web sandbox and frequently flakes on
environment differences (browser binaries, ports, fixtures). The faster, more reliable
loop is:

1. Reproduce + fix locally.
2. Verify with the **non-E2E** gates (`pnpm verify`, targeted unit/integration tests).
3. Push the branch, open a PR, and let GitHub Actions run the full E2E suite.
4. Subscribe to PR activity and react to CI failures as they come in.

Do **not** run `pnpm verify:e2e` or `RUN_E2E=1` in the sandbox unless the user explicitly
asks for it.

## When to use

- The user reports a bug or regression and wants it fixed.
- A failing test (unit, integration, or E2E) needs investigation and repair.
- A PR has CI failures that need to be patched.

## When NOT to use

- Pure refactors with no bug attached (no PR-on-CI loop needed).
- Production-only investigations with no code change yet — start with `debugging-prod`.

## Loop

### 1. Reproduce and fix

- Read `CLAUDE.md` and the per-app CLAUDE for the affected scope before editing.
- Write or extend a unit/integration test that fails because of the bug, then make it pass.
- Keep the fix minimal — no surrounding cleanup, no speculative refactors.

### 2. Verify locally (no E2E)

Run, in order, only what's relevant to the change:

```bash
pnpm test:unit                 # fast, always run
pnpm test:integration          # if you touched DB / jobs / tRPC
pnpm verify                    # build + lint + unit (full local gate, no E2E)
```

Skip `pnpm verify:e2e`, `pnpm verify:coverage`, and any Playwright/Maestro invocation in
the sandbox. CI will run the full suite — that's the point of step 3.

If `pnpm verify` passes, the local gate is green. Move on.

### 3. Open the PR

- Commit on the assigned development branch (per the session instructions).
- Push with `git push -u origin <branch>`.
- Create the PR with `mcp__github__create_pull_request`. Title under 70 chars; body has
  a short Summary and a Test plan checklist. **No `claude.ai/code` session footer, no
  `Co-authored-by: Claude` trailer** (see `CLAUDE.md` → "Commit and PR hygiene").

### 4. Subscribe to CI and respond

Immediately after creating the PR, subscribe so E2E + lint + coverage failures stream back:

```
mcp__github__subscribe_pr_activity { owner: "ethanasm", repo: "showbook", pullNumber: <n> }
```

Then tell the user the PR URL and that you're watching CI. While CI runs, you can move on
to other work — events arrive wrapped in `<github-webhook-activity>` tags.

When a failure event arrives:

1. Pull the failing job's logs (via the GitHub MCP tools) and identify the failing test
   and the assertion or stack frame.
2. Decide if it's a real regression in the diff, a pre-existing flake, or an environment
   issue. For E2E flakes, check the test for known flaky patterns before retrying.
3. If it's a real failure, fix it locally, re-run the relevant **non-E2E** gate, and push
   the fix. CI re-runs automatically.
4. Repeat until CI is green. Unsubscribe with `mcp__github__unsubscribe_pr_activity` once
   the PR is merged or the user releases you.

## Why no local E2E

- Playwright in the web sandbox uses a CFT-fallback Chromium and the dev server on port
  3003; failures here are usually environmental, not real bugs, and they burn minutes.
- CI runs Playwright in a clean Linux environment with the proper browser bundle and
  isolated Postgres — its signal is the one that gates merge.
- Coverage thresholds (80% line/branch/function on web and mobile scopes) are also
  enforced by CI; trust that gate rather than running `verify:coverage` locally unless
  you're specifically debugging a coverage drop.

## Anti-patterns

- Running `pnpm verify:e2e` "just to be sure" before pushing — don't.
- Skipping the PR and asking the user to run E2E themselves — open the PR; CI is the loop.
- Pushing speculative fixes without first reading the CI failure log.
- Using `--no-verify` to bypass a failing pre-commit hook — fix the underlying issue.
