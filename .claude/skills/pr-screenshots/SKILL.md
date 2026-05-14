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
2. Revert just the changed source files to the parent commit and
   re-run the same spec, renaming the output to `…-before.png`:

   ```
   # Caller (bug-fixing / creating-prs) typically has already
   # committed the diff, so `git stash` is a no-op trap that silently
   # captures the AFTER state twice. Use per-file checkout instead:
   git checkout HEAD^ -- <changed-files>
   node ...your capture script... before
   git checkout HEAD -- <changed-files>  # restore AFTER state
   ```

   If you use `git stash`, **first verify it actually moved the tree**:
   `git status` after stash must show no modified files. If it shows
   `No local changes to save`, the captures are coming from the same
   tree state — both PNGs are AFTER — and any "before/after" framing
   you post is a lie.
3. Restore the working tree, upload both sets, and embed them in the
   PR body. If the "before" capture isn't possible (route didn't
   exist, transient state can't be reproduced), say so explicitly in
   the PR body rather than silently shipping only the "after".

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

### 5. Pixel-diff the captures and pick a layout the reader can see

Screenshots are a **quality gate**, not just decoration. After capture
and before posting, you must verify the change is actually perceptible
in the form a reviewer will see it. Two failures kill this gate:

- **Sub-pixel deltas.** A 4 px CSS padding change on a 390 px-wide
  full-page mobile screenshot is ~1% of width. GitHub will then
  render that PNG inside the PR body at a fraction of native size
  (worse if you put it in a multi-column markdown table — each cell
  may be 60–80 px wide, turning a 4 px source delta into ~0.5 px on
  screen, i.e. invisible). The reviewer cannot validate what they
  cannot see.
- **Wrong frame.** A full-page screenshot wastes most of its pixels
  on chrome (header, nav, filters) that didn't change. The 50 px tall
  row you actually edited gets ~3% of the embedded image.

**Mandatory pixel-diff sanity check.** After capture, run a per-image
diff and read it yourself. Use the repo-local `pngjs` (already a
dep) — no install required:

```
node -e "
const {PNG}=require('pngjs');const fs=require('fs');
function load(p){return PNG.sync.read(fs.readFileSync(p));}
function pct(a,b){if(a.width!==b.width||a.height!==b.height)return'size-mismatch';
  const t=a.width*a.height;let d=0;
  for(let i=0;i<a.data.length;i+=4)if(a.data[i]!==b.data[i]||a.data[i+1]!==b.data[i+1]||a.data[i+2]!==b.data[i+2])d++;
  return{dim:a.width+'x'+a.height,total:t,diff:d,pct:+(d/t*100).toFixed(2)};}
for (const [a,b] of [['before.png','after.png']]) console.log(JSON.stringify(pct(load(a),load(b))));"
```

Interpret the result against the embedded display size, not the raw
pixel count:

| pct diff | meaning | action |
|---|---|---|
| `0%` | identical | capture failed — usually the before/after revert step (see step 2) didn't actually change the tree. Investigate and re-shoot. |
| `< 2%` | invisible at thumbnail scale | re-shoot with an element-level crop (see below) or full-width display, no multi-column table |
| `2–5%` | borderline | usually needs element-level crop; full-width stacked layout at minimum |
| `> 5%` | clearly visible | full-page is fine if the layout puts it at usable size |

**Element-level capture for subtle changes.** When the change is
spacing, padding, gap, or border on a specific element, screenshot
that element — not the whole page. Playwright supports this directly:

```js
await page.locator('.discover-row').first().screenshot({
  path: 'discover-row-after.png',
});
```

For a top-of-component framing (e.g. table header + first few rows),
use `clip` with the bounding box of the container plus a small
margin:

```js
const box = await page.locator('.shows-list-table').first().boundingBox();
await page.screenshot({
  path: 'shows-table-top.png',
  clip: { x: box.x - 2, y: box.y - 2, width: box.width + 4, height: 360 },
});
```

Bumping `deviceScaleFactor: 2` on the context doubles the raw image
resolution so the embedded PNG stays sharp at GitHub's render size
even after the browser scales it down.

**Embedding layout.** Put each route's before/after on consecutive
lines as full-width images (`![alt](url)` on its own line), not in a
2- or 3-column markdown table:

```md
**Before**
![row before](…/before-row.png)

**After**
![row after](…/after-row.png)
```

GitHub renders these at the body's full width, so a 780 px source
image stays large enough to read. Reserve multi-column tables for
*responsive comparisons* where each column is a different viewport —
and only when the per-cell render width is still readable.

**Cross-check the user's ask.** Re-read what the user actually asked
for ("more left padding", "tighter line height", "table doesn't
fit"). If your final screenshot doesn't show that specific axis
moving in the expected direction, the code change is wrong — go
back and fix it. If the after-screenshot looks identical to before,
**do not post it and declare done.** Re-shoot with a tighter frame,
or surface the blocker to the user explicitly.

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
- **Posting before/after PNGs without running the pixel-diff in step 5.**
  Identical hashes, < 2% diff at thumbnail render size, or a
  full-page frame for a 4 px CSS change — all of these ship a PR
  the user can't validate. The diff check is non-optional.
- **`git stash` for the before-capture when the change is already
  committed.** Stash silently no-ops when the tree is clean, so both
  the "before" and "after" runs capture AFTER. Use
  `git checkout HEAD^ -- <files>` (or against the PR base) and
  confirm with `git status` that the tree actually moved before
  capturing.
- Embedding subtle visual changes in a multi-column markdown table.
  GitHub shrinks each cell to a fraction of the body width; a 4 px
  delta becomes sub-pixel and disappears. Stack before/after as
  full-width images instead.
