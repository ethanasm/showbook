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

### 3. Hand off to creating-prs

Commit on the assigned development branch, then invoke the `creating-prs` skill — it
owns push, PR creation, PR-activity subscription, the CI-failure → fix → re-push loop,
and the `pr-screenshots` hand-off when the diff touches UI.

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
