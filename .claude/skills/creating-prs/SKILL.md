---
name: creating-prs
description: Showbook-flavored creating-prs. The generic push / open / subscribe / hand-off loop lives in ~/.claude/skills/creating-prs/SKILL.md; this override only carries showbook-specific config and the extra mobile hand-off step.
---

# creating-prs (showbook overrides)

**Base playbook:** Read `~/.claude/skills/creating-prs/SKILL.md` and
follow it as the canonical flow. The sections below *replace or
extend* the corresponding sections of the base — do not duplicate
the generic content here.

Also read `~/.claude/skills/commit-hygiene/SKILL.md` for the
commit/PR-body rules. The repo-root `CLAUDE.md` → "Commit and PR
hygiene" section pins those same rules.

## Config

- **owner/repo** — `ethanasm/showbook` (do not parse the remote; the
  GitHub MCP scope is pinned to this slug).
- **UI globs** — covers web *and* mobile:
  - Web: `apps/web/app/**`, `apps/web/components/**`, `apps/web/lib/**/*.tsx`
  - Mobile: `apps/mobile/app/**`, `apps/mobile/components/**`
- **Fast verify command** — `pnpm verify` (build + lint + unit, no
  E2E). See `apps/web/CLAUDE.md` for the per-app gates.
- **Slow gate (CI-only)** — `pnpm verify:e2e`, `pnpm verify:coverage`,
  and the Maestro Cloud `mobile-e2e` workflow. Do not run any of
  these in the sandbox.

## Step 4 override — visual review material

When the diff touches the **web** globs, hand off to `pr-screenshots`
with scope `web` per the base flow (Playwright + orphan
`pr-screenshots` branch, with the showbook upload script at
`scripts/upload-pr-screenshots.mjs`).

When the diff also touches the **mobile** globs, in addition trigger
the showbook mobile capture path: attach the `mobile-visual` label to
the PR via `mcp__github__issue_write` (action `add_labels`). The
`mobile-e2e` workflow's PR trigger is gated on this label and will
edit a `## Mobile screenshots` section into the PR body itself. See
the showbook override of `pr-screenshots` for the full mobile rules.

If only the mobile globs match, skip the web Playwright capture
entirely and just add the label.

## Step 6 override — event handling

Reactions still go through `react-to-pr-activity`, but two showbook
specifics apply:

- Coverage failures in CI are *real regressions* by definition
  (`scripts/coverage-report.mjs` enforces 80% line/branch/function on
  web and mobile scopes). Don't retry — write tests.
- A failing `mobile-e2e` workflow run after the `mobile-visual` label
  was attached usually means the Maestro flow or the EAS build broke,
  not a regression in the diff. Check the EAS build log before
  classifying as flake.

## Anti-patterns (showbook-specific, additive)

- Running `pnpm verify:e2e` or `RUN_E2E=1` in the sandbox to "be
  sure" before pushing. CI is the loop.
- Re-attaching `mobile-visual` on every push to a mobile-touching
  branch — each label-attach burns an EAS build minute. Once
  per relevant change is enough; let the workflow re-run on push.
- Including a `https://claude.ai/code/session_…` footer in the PR
  body or any commit message. See repo-root `CLAUDE.md`.
