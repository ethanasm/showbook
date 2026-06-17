# Creating PRs — reference skill

A skill that owns the tail end of every change loop: merge latest main,
push, open the PR, attach visual review material if UI changed, then
subscribe to CI and react to failures. Extracted from a Next.js monorepo
that uses the GitHub MCP server (tools prefixed `mcp__github__`). Adapt the
project-specific bits flagged **[ADAPT]** below.

Drop this in as `.claude/skills/creating-prs/SKILL.md`. The YAML
frontmatter is what makes Claude Code auto-invoke it.

---

```markdown
---
name: creating-prs
description: Use after committing changes that need to ship. Pushes the branch, opens the PR via the GitHub MCP tools, subscribes to PR activity so CI failures stream back, and (when the diff touches UI) hands off to the pr-screenshots skill so the PR description gets visual review material inline.
---

# Creating PRs

## Overview

The bug-fixing, refactor, and feature loops all end the same way: push,
open a PR, watch CI. This skill owns that tail so other skills can delegate
instead of re-implementing it. It also decides whether the PR needs visual
review material attached and triggers the `pr-screenshots` skill if so.

## When to use

- A caller skill hands off after the local verify gate is green and the
  change is committed locally.
- The user asks "open a PR" or "ship this".

## When NOT to use

- The change is still WIP and the user hasn't asked to push it.
- A PR already exists for this branch — re-push and let the existing
  subscription stream new CI events instead.

## Loop

### 1. Merge latest `main` into the branch

Before pushing, fetch and merge the current `origin/main` into the working
branch so the PR is reviewed against (and CI runs against) an up-to-date
base — and so we catch interaction conflicts locally instead of in CI:

    git fetch origin main
    git merge origin/main --no-edit

If `git merge` reports conflicts, resolve them, re-stage, and commit the
merge before continuing. If the merge pulls in meaningful changes
(non-trivial diff outside the branch's own files), re-run the verify gate
so the local check still reflects what's about to ship.

[ADAPT] If the checkout is a shallow clone (Claude Code web sandbox),
`git fetch origin main` brings in just the commits needed for the merge
base. Don't `git fetch --unshallow`; don't rebase onto main; don't merge
from a non-`origin` remote.

### 2. Push the branch

    git push -u origin <branch>

If the push fails on a network error, retry up to 4× with exponential
backoff (2s, 4s, 8s, 16s). Don't retry on non-network failures — debug
those first.

### 3. Open the PR

Use `mcp__github__create_pull_request`. Constraints:

- Title is a **conventional commit** — `type(scope)?: imperative summary`,
  under 70 chars; details go in the body.
  [ADAPT] If the repo squash-merges and reads the squashed subject for
  release automation (e.g. semantic version bumps), the type matters:
  `feat:` → minor, `fix:`/`docs:`/`chore:`/`ci:`/`refactor:`/`perf:`/
  `test:` → patch, breaking `!` → major. Otherwise just keep titles
  conventional for a clean history.
- Body has `## Summary` (1–3 bullets) and `## Test plan` (markdown
  checklist).
  [ADAPT] Strip any auto-appended footers your harness adds —
  `https://claude.ai/code/session_…` links, `Co-authored-by: Claude`,
  "Generated with Claude Code" — if your project convention forbids them.

Tell the user the PR URL as soon as it's created.

### 4. Attach visual review material if the diff touches UI

Run `git diff --name-only main...HEAD` (or against the PR base) and match
against your UI paths:

[ADAPT] e.g. `apps/web/app/**`, `apps/web/components/**`,
`apps/web/lib/**/*.tsx`, `apps/mobile/app/**`, `apps/mobile/components/**`.

If anything matches, invoke the `pr-screenshots` skill and pass it the PR
number and the matched scope. It handles capture + hosting + PR-body
update. If nothing matches, skip.

### 5. Subscribe to CI activity

    mcp__github__subscribe_pr_activity { owner: "<OWNER>", repo: "<REPO>", pullNumber: <n> }

[ADAPT] Set owner/repo for your project. Events arrive wrapped in
`<github-webhook-activity>` tags. While CI runs you can move on to other
work.

### 6. React to events

When a failure event arrives:

1. Pull the failing job's logs via the GitHub MCP tools and identify the
   failing test plus its assertion or stack frame.
2. Decide if it's a real regression in the diff, a pre-existing flake, or
   an environment issue. For E2E flakes, check the test for known flaky
   patterns before retrying.
3. If it's a real failure, fix it locally, re-run the relevant gate, and
   push. CI re-runs automatically.
4. Repeat until CI is green. Unsubscribe with
   `mcp__github__unsubscribe_pr_activity` once the PR is merged or the user
   releases you.

For review-comment events (someone left a code-review comment), use your
judgement: if the suggestion is clear and not architecturally significant,
apply it; if it's ambiguous, ask the user before acting.

## Anti-patterns

- Pushing to `main` directly — always go through a PR.
- Force-pushing to a PR branch without telling the user.
- Skipping the PR-body screenshots section on UI changes — reviewers
  shouldn't have to pull the branch to see what changed visually.
- Using `--no-verify` to bypass a failing pre-commit hook — fix the
  underlying issue.
```

---

## Notes for porting

- **GitHub MCP server is required.** This skill assumes the
  `mcp__github__*` tools are available (create_pull_request,
  subscribe_pr_activity, unsubscribe_pr_activity, get_job_logs, etc.). If
  your environment uses the `gh` CLI instead, swap those calls for `gh pr
  create`, `gh run watch`, `gh run view --log`, etc. — the loop structure
  is identical.
- **The subscribe/react loop only works if your harness delivers webhook
  events** back into the session as messages. In Claude Code on the web,
  PR activity arrives as `<github-webhook-activity>` messages that wake the
  session. Without that, replace step 5–6 with a polling check the user
  triggers.
- **`pr-screenshots` is a separate skill** this one delegates to. If you're
  porting both, grab that one too; if you don't need inline visual review,
  delete step 4 and the related anti-pattern.
- **Two project-specific assumptions to revisit:** (1) the conventional-
  commit *type → version bump* mapping only matters if you have release
  automation reading squashed subjects; (2) the "shallow clone, don't
  unshallow" guidance is specific to the web sandbox checkout.
```
