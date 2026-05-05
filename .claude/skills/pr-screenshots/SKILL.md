---
name: pr-screenshots
description: Use after opening a PR whose diff touches UI. Captures targeted Playwright screenshots for web changes and triggers the label-gated Maestro Cloud workflow for mobile changes, then embeds the visual review material into the PR body so reviewers don't have to pull the branch. Invoked by the creating-prs skill.
---

# PR screenshots

## Overview

Visual review happens inline in the PR description. Two surfaces, two
capture paths:

- **Web** — Playwright runs locally (the sandbox has Chromium and the
  Next.js dev server) and produces full-page PNGs of the affected
  routes. PNGs are pushed to an orphan `pr-screenshots` branch in this
  repo and embedded as `https://github.com/ethanasm/showbook/raw/...`
  URLs. Cost: ~30–60s of dev-server + Chromium time per run; storage
  is free (orphan branch).
- **Mobile** — the sandbox can't run iOS or KVM-backed Android, so
  capture happens on Maestro Cloud via the existing `mobile-e2e`
  workflow. The skill attaches the `mobile-visual` label to the PR;
  the workflow does the build, runs the flows, and edits the
  `## Mobile screenshots` section into the PR body itself. Cost: 1
  EAS build + 3 Maestro flows per labelled PR (free tier handles
  ~30 PRs/month combined).

There is no sandbox-local mobile capture path. That's a
Linux-without-KVM constraint, not a skill choice.

## When to use

- The `creating-prs` skill detected UI changes in the diff and handed
  off with a PR number + scope (`web`, `mobile`, or both).
- The user explicitly asks for screenshots on a PR.

## When NOT to use

- The diff doesn't touch `apps/web/{app,components}/**`,
  `apps/web/lib/**/*.tsx`, or `apps/mobile/{app,components}/**`. Web
  Playwright is slow enough that running it on backend-only changes
  wastes minutes; mobile Maestro burns EAS build minutes for nothing.
- The PR is a doc-only or config-only change.

## Web flow

### 1. Build the route list

From the diff, map touched files to routes:

- `apps/web/app/(app)/<segment>/page.tsx` → `/<segment>`
- `apps/web/app/(app)/<segment>/[id]/page.tsx` → ask the user for a
  representative id, or skip detail pages without one
- `apps/web/components/...` shared in many pages → ask the user which
  pages to capture, or use a default route list (`/home`, `/shows`,
  `/venues`, `/artists`, `/discover`, `/preferences`)

Write the resulting list to `apps/web/tests/.pr-screenshots.json`:

```json
{ "routes": ["/home", "/shows"] }
```

This file is gitignored. Don't commit it.

### 2. Run Playwright

Pick the viewport via the existing project name:

```
pnpm --filter web exec playwright test tests/pr-screenshots.spec.ts \
  --project=desktop-dark --workers=1
```

Use `--project=mobile` instead for a 390×844 viewport. Run both
sequentially if the change is responsive-sensitive.

PNGs land in `apps/web/test-results/screenshots/`. Delete
`apps/web/tests/.pr-screenshots.json` after the run.

**Before/after is preferred whenever the change is visual** (spacing,
sizing, color, copy, layout). One screenshot of the new state forces
reviewers to imagine the old one — show both side-by-side. Capture
order:

1. Run the spec on the current branch (HEAD) to produce the "after"
   PNGs, then rename / move them into a `…-after.png` set so the next
   run doesn't overwrite them.
2. `git stash` (or `git checkout <merge-base>` in a clean tree) to
   reach the parent state, re-run the same spec, rename the output to
   `…-before.png`.
3. Restore the working tree (`git stash pop` / `git checkout -`),
   upload both sets, and embed them in the PR body as a two-row layout
   (one row "Before", one row "After") so reviewers can scan the
   delta. If the "before" capture isn't possible (route didn't exist,
   transient state can't be reproduced), say so explicitly in the PR
   body rather than silently shipping only the "after".

### 3. Push to the orphan branch

```
node scripts/upload-pr-screenshots.mjs --branch <branch> --pr <n>
```

The script publishes PNGs to `pr-screenshots:<branch>/<name>.png` and
prints a JSON array of `{ name, url }`. The orphan branch is created
on first run.

### 4. Update the PR body

Read the current body via `mcp__github__pull_request_read` and append
or replace a `## Screenshots` section bracketed by sentinel comments
so re-runs replace cleanly:

```
<!-- web-screenshots:start -->
## Screenshots
![home](https://github.com/ethanasm/showbook/raw/pr-screenshots/<branch>/home.png)
![shows](https://github.com/ethanasm/showbook/raw/pr-screenshots/<branch>/shows.png)
<!-- web-screenshots:end -->
```

Edit via `mcp__github__update_pull_request`.

## Mobile flow

### 1. Add the label

Use `mcp__github__issue_write` with action `add_labels` and label
`mobile-visual`. The `mobile-e2e` workflow's PR trigger is gated on
this label, so attaching it kicks off the build + flows.

### 2. Hand back to creating-prs

The workflow does the rest — it captures the Maestro Cloud upload URL
and edits a `## Mobile screenshots` section into the PR body itself
(bracketed with `<!-- mobile-screenshots:start -->` sentinels for
clean replacement on re-runs).

`creating-prs` is already subscribed to PR activity, so the user sees
the workflow finish and the body update arrive as webhook events.

## Anti-patterns

- Capturing every page in the app on every PR — pick targeted routes
  from the diff or ask the user.
- Committing `apps/web/tests/.pr-screenshots.json` — it's gitignored
  for a reason.
- Pushing PNGs to `main` or to the PR branch itself — that bloats the
  source tree and the PR diff. Always go through the orphan branch.
- Manually attaching mobile screenshots from a teammate's device —
  the Maestro Cloud capture is reproducible; ad-hoc captures aren't.
- Re-running the mobile workflow without removing the label first
  when the user only wanted one capture — they're EAS-build-minutes
  expensive.
