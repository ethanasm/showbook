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

### 1. Push the branch

```
git push -u origin <branch>
```

If the push fails on a network error, retry up to 4× with exponential
backoff (2s, 4s, 8s, 16s). Don't retry on non-network failures — debug
those first.

### 2. Open the PR

Use `mcp__github__create_pull_request`. Constraints:

- Title under 70 chars; details go in the body.
- Body has `## Summary` (1–3 bullets) and `## Test plan` (markdown
  checklist). No `https://claude.ai/code/session_…` footer, no
  `Co-authored-by: Claude` trailer, no "Generated with Claude Code"
  line — see repo-root `CLAUDE.md` → "Commit and PR hygiene".

Tell the user the PR URL as soon as it's created.

### 3. Attach visual review material if the diff touches UI

Run `git diff --name-only main...HEAD` (or against the PR base) and
match against:

- **Web UI**: `apps/web/app/**`, `apps/web/components/**`,
  `apps/web/lib/**/*.tsx`
- **Mobile UI**: `apps/mobile/app/**`, `apps/mobile/components/**`

If anything matches, invoke the `pr-screenshots` skill and pass it the
PR number and the matched scope (`web`, `mobile`, or both). It handles
capture + hosting + PR-body update. If nothing matches, skip.

### 4. Subscribe to CI activity

```
mcp__github__subscribe_pr_activity { owner: "ethanasm", repo: "showbook", pullNumber: <n> }
```

Events arrive wrapped in `<github-webhook-activity>` tags. While CI
runs you can move on to other work.

### 5. React to events

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
