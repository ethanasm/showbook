---
name: pr-screenshots
description: Use after opening a PR whose diff touches UI. Captures targeted Playwright screenshots for web changes AND for mobile changes (Expo Web bundle), embeds inline before/after for every touched surface into the PR body, and additionally triggers the label-gated native Maestro workflow for mobile diffs. Invoked by the creating-prs skill.
---

# PR screenshots

## Overview

Visual review happens inline in the PR description. **Every surface
the diff touches gets inline before/after screenshots in the PR body
before this skill is done** — the mobile-visual label / native
workflow is a supplement, never a substitute. If the diff touches
both web and mobile, the body gets both sets. Capture paths:

- **Web** — Playwright runs locally (the sandbox has Chromium and the
  Next.js dev server) and produces PNGs of the affected routes. PNGs
  are pushed to an orphan `pr-screenshots` branch in this repo and
  embedded as `https://github.com/ethanasm/showbook/raw/...` URLs.
  Cost: ~30–60s of dev-server + Chromium time per run; storage is
  free (orphan branch).
- **Mobile, inline (mandatory for mobile diffs)** — the sandbox can't
  run iOS or a KVM-backed Android emulator, but it CAN render the
  Expo **Web** bundle (`pnpm mobile:web:build`, then Playwright at
  390×844 against `dist-web/` — same harness as
  `apps/mobile/web-tests/*.spec.ts`; see "Headless web verification"
  in `apps/mobile/CLAUDE.md`). Capture the changed screen here and
  embed before/after exactly like the web flow. Details in "Mobile
  flow" below.
- **Mobile, native (supplementary)** — attaching the `mobile-visual`
  label triggers the self-hosted `mobile-e2e` workflow (Android build
  + Maestro flows). On success it only links the run and uploads the
  screenshots as a CI artifact — reviewers won't see them inline,
  which is exactly why the Expo-web captures above are not optional.

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

**Capture the rendered state, not a loading skeleton (the #1 failure).**
The shared `pr-screenshots.spec.ts` waits only for `domcontentloaded`, which
fires *before* client-side tRPC `useQuery` calls resolve. For any route whose
content is fetched after mount (Discover feeds, the digest "New for you" tab,
anything with skeletons/spinners), that default capture freezes the **loading
skeleton** — useless review material. For those routes, stage a one-off spec
that logs in, navigates, and **blocks on the rendered content** before the
shot:

```js
await page.waitForLoadState('networkidle');
await expect(page.locator('.discover-row').first()).toBeVisible({ timeout: 30_000 });
await page.waitForTimeout(800); // let layout settle
await takeScreenshot(page, 'pr-after-<route>');
```

**Seed the data the surface needs.** A render-wait still captures an *empty
state* if the fixture user has no rows. Make sure `/api/test/seed` (or the
worker seed) actually populates what the screen shows — and that it exercises
every section/variant the change introduces (e.g. the digest tab must have
venue **and** artist **and** region rows so all three reason headers render,
not just one). If you can't seed a section, say so in the PR body instead of
shipping a partial capture.

**Save each capture the instant it's taken.** Playwright wipes
`test-results/` at the start of every run, so the moment you capture the
"after", copy it to a separate staging dir (e.g. a scratch folder) before you
run the "before" pass — otherwise the before-run silently deletes your after,
and a later "recover from disk" step grabs whatever stale/wrong PNG is lying
around (this is exactly how a skeleton shot once shipped as the "after").

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

**The script wipes `<branch>/` on every run** before copying, so a
re-upload must stage *every* PNG the PR body references (web + mobile,
before + after) in one `--dir`, or previously-embedded images 404.

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

Edit via `mcp__github__update_pull_request`. Note: the MCP write path
strips HTML comments, so don't count on the sentinels surviving —
after the first update, locate the section by its `## Screenshots`
heading (everything up to the next `##`) when replacing it.

### 5. Pixel-diff the captures and pick a layout the reader can see

**First, actually look at every PNG you're about to post.** Open each
capture (Read the file) and confirm it shows the *preferred, fully-rendered*
state the change is about — the right tab/screen active, the expected
sections and rows present, real data (not a skeleton, spinner, empty state,
error, or blank page). A green Playwright run only proves the spec passed; it
does **not** prove the frame is the one you want. If the image shows a
skeleton, an empty section, the wrong tab, or a blank page, it is **not**
shippable — fix the wait/seed/selector and re-capture before doing anything
else. Posting a capture you didn't visually verify is the most common way
this skill ships misleading review material.

Then run the pixel-diff below. Screenshots are a **quality gate**, not just
decoration. After capture and before posting, you must verify the change is
actually perceptible in the form a reviewer will see it. Two failures kill
this gate:

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

### 1. Capture inline before/after from the Expo Web bundle

This is the part reviewers actually see — do it for every mobile
diff, even when the native workflow is also triggered.

1. Build the bundle at HEAD: `pnpm mobile:web:build` (writes
   `apps/mobile/dist-web/`). **Then confirm the harness actually
   renders before trusting any capture: run `pnpm exec playwright
   test web-tests/smoke.spec.ts`.** The Expo-web build is brittle —
   after a `main` merge or dep bump it can fail to resolve hoisted
   transitive deps (e.g. `Cannot find module '@babel/types'` /
   `@babel/generator` from `babel-preset-expo`), and a half-built /
   stale `dist-web` makes the static server return 500s so *every*
   capture comes out blank ("read error", a ~10 KB white PNG, or
   `getByRole(...)` finding 0 tabs). If smoke fails, rebuild; if the
   build itself fails on a missing `@babel/*` module, add the missing
   packages as root dev-deps to unblock the local build
   (`pnpm add -w -D @babel/types@<v> @babel/generator@<v>
   @babel/traverse@<v> @babel/parser@<v> @babel/template@<v>`),
   capture, then **revert `package.json` + `pnpm-lock.yaml`** so the
   workaround never lands in the PR.
2. Stage a temporary spec under `apps/mobile/web-tests/` (don't
   commit it; delete after). Copy the patterns from the existing
   specs there: seed the session via `page.addInitScript` writing the
   `secureStore::showbook.auth.*` localStorage keys, mock
   `**/api/trpc/**` with `page.route` fixtures shaped like the
   procedures the screen calls (envelope: `{ result: { data: { json:
   <payload> } } }`, and handle `batch=1` by splitting the comma-joined
   procedure list), navigate to the route (`/discover`, `/(tabs)/<tab>`,
   or a stack route), switch to the relevant tab via
   `getByRole('button', { name })` (react-native-web renders
   `SegmentedControl` options as buttons, not plain text), **wait for
   the rendered rows** (e.g. `getByText('<a seeded headliner>')` or a
   row testID — `useCachedQuery` screens read an empty SQLite shim on
   web then fall back to the mocked network, so the list appears a beat
   after `networkidle`), then screenshot. Mock every section the change
   shows (e.g. digest rows with `reason: 'venue' | 'artist' | 'region'`
   so all section headers render). Capture **both** a full-screen shot
   (context) and an element/clip crop of the changed region (the
   thing the pixel-diff gate judges). The harness viewport is 390×844
   @2x, so full-screen PNGs are 780px wide — readable at GitHub's
   render width.
3. The "before" set needs a **rebuild**, not just a file revert — the
   bundle bakes the source in: `git checkout <base> -- <changed
   mobile files>`, `pnpm mobile:web:build`, re-run the spec with a
   `…-before.png` output name, then `git checkout HEAD -- <files>`
   and rebuild if you need the after-state bundle again.
4. Pixel-diff and embed exactly like web steps 3–5 (same orphan
   branch, same upload script, same `## Screenshots` section — use a
   `### Mobile` subsection beside the `### Web` one).

Caveats: the Expo-web render uses `web-shims/` (native maps render as
an empty dark area, no SQLite cache), so frame the capture around the
UI you changed, not map tiles. See "Headless web verification" in
`apps/mobile/CLAUDE.md` for what the web bundle can and cannot show —
if the changed UI is native-only (e.g. map markers, camera), say so
in the PR body and lean on the native workflow below.

### 2. Add the label for the native (Android) capture

Use `mcp__github__issue_write` with action `add_labels` and label
`mobile-visual`. The `mobile-e2e` workflow's PR trigger is gated on
this label, so attaching it kicks off the self-hosted Android build +
Maestro flows.

### 3. Hand back to creating-prs

The workflow edits its own section into the PR body when it finishes.
Know what it does and doesn't give you: on **success** it links the
run and stores the Maestro screenshots as the `maestro-debug-<run-id>`
artifact (not inline); on **failure** it pushes screenshots to the
orphan branch under `mobile-e2e/run-<id>/` and comments with raw
URLs. Either way it does not replace the inline Expo-web captures
from step 1.

`creating-prs` is already subscribed to PR activity, so the user sees
the workflow finish and the body update arrive as webhook events.

## Anti-patterns

- **Posting a capture you never opened.** A passing Playwright run is
  not a verified screenshot. Always Read the PNG and confirm it shows
  the rendered, preferred state before uploading — skeletons, empty
  sections, the wrong tab, and blank pages all "pass" the spec.
- **Shipping a loading skeleton as the "after".** The default web spec
  captures at `domcontentloaded`, before client tRPC queries resolve.
  Wait for the rendered content (a content selector + `networkidle`),
  and seed the data so the surface isn't empty.
- **Letting a "before" run delete your "after".** Playwright wipes
  `test-results/` each run; copy the after PNG to a staging dir the
  instant it's captured, or you'll recover a stale/wrong file later.
- **Covering a mobile diff with only the `mobile-visual` label.** The
  native workflow's screenshots land in a CI artifact, not the PR
  body — a reviewer opening the PR sees nothing. A diff that touches
  `apps/mobile/{app,components}` is not done until inline Expo-web
  before/after captures are embedded; a diff touching both surfaces
  needs both a `### Web` and a `### Mobile` set.
- Capturing the mobile "before" by reverting source files without
  rebuilding `dist-web` — the bundle is baked at export time, so both
  captures come out as AFTER.
- Capturing every page in the app on every PR — pick targeted routes
  from the diff or ask the user.
- Committing `apps/web/tests/.pr-screenshots.json` — it's gitignored
  for a reason.
- Pushing PNGs to `main` or to the PR branch itself — that bloats the
  source tree and the PR diff. Always go through the orphan branch.
- Manually attaching mobile screenshots from a teammate's device —
  the Maestro Cloud capture is reproducible; ad-hoc captures aren't.
- Re-running the mobile workflow without removing the label first
  when the user only wanted one capture — each run is a full Android
  build + emulator boot on the self-hosted runner.
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
