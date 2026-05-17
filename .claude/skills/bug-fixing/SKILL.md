---
name: bug-fixing
description: Use when fixing a bug in the showbook codebase. Showbook-flavored thin wrapper around the generic verify-then-ship loop — pins the fast gate to `pnpm verify`, defers E2E / coverage / Maestro to CI, and hands off to the showbook creating-prs override.
---

# bug-fixing (showbook)

**Base playbook:** Read `~/.claude/skills/verify-then-ship/SKILL.md`
for the reproduce → fast-gate → push → react loop. This file only
carries the showbook-specific commands and rationale.

Also read `~/.claude/skills/commit-hygiene/SKILL.md` for the
commit-message rules (no session-link footer, no Claude attribution
trailers, HEREDOC for multi-line messages).

## Config

- **Unit gate** — `pnpm test:unit` (always, fast)
- **Integration gate** — `pnpm test:integration` (only if you touched
  DB / jobs / tRPC; 45 s per-test timeout, 5 min batch cap enforced
  by `scripts/run-integration.mjs`)
- **Fast verify gate** — `pnpm verify` (build + lint + unit, no E2E)
- **Slow gates (CI-only)** — `pnpm verify:e2e`, `pnpm verify:coverage`,
  the Maestro Cloud `mobile-e2e` workflow

CI's `.github/workflows/ci.yml` enforces 80% line/branch/function
coverage on the web and mobile scopes via
`scripts/coverage-report.mjs`. Trust that gate.

## Why no local E2E / coverage in the sandbox

- Playwright in the web sandbox uses a CFT-fallback Chromium and
  the dev server on port 3003. Failures here are usually
  environmental, not real bugs, and they burn minutes.
- The Maestro mobile flow requires Maestro Cloud + EAS build — can't
  run locally at all.
- CI runs the slow gates in a clean Linux environment with the
  proper browser bundle and isolated Postgres — its signal is the
  one that gates merge.
- Coverage is enforced by CI on every push and PR to `main`. Run
  `verify:coverage` locally only when specifically debugging a
  coverage drop.

## Hand-off

After the fast gate passes, commit on the assigned development
branch and invoke `creating-prs` (the showbook override). It owns
push, PR creation, the `pr-screenshots` hand-off (web + mobile),
PR-activity subscription, and the CI-failure → `fix-ci-failure`
hand-off.

## When NOT to use

- Pure refactors with no bug attached — go straight to the
  `verify-then-ship` / `creating-prs` chain.
- Production-only investigations with no code change yet — start
  with `debugging-prod`.

## Anti-patterns (showbook-specific, additive to verify-then-ship)

- Running `pnpm verify:e2e` or `RUN_E2E=1` in the sandbox "just to
  be sure".
- Running the test suite against `showbook_prod*` — `scripts/guard-not-prod-db.mjs`
  rejects this, but don't rely on the guard.
- Pushing a coverage-dropping fix and waiting for CI to tell you —
  write the test in the same commit.
