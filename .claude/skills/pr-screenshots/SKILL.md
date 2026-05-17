---
name: pr-screenshots
description: Showbook-flavored pr-screenshots. The web Playwright capture + pixel-diff flow lives in ~/.claude/skills/pr-screenshots/SKILL.md; this override only carries showbook-specific config and the mobile Maestro Cloud flow (which has no generic counterpart yet).
---

# pr-screenshots (showbook overrides)

**Base playbook:** Read `~/.claude/skills/pr-screenshots/SKILL.md`
and follow it as the canonical web flow. The sections below
**replace** the corresponding base sections with showbook-specific
values, and **add** the mobile flow that the base doesn't cover.

## Web config

- **Owner/repo for embed URLs** — `ethanasm/showbook`
- **Orphan branch** — `pr-screenshots`
- **Upload script** — `scripts/upload-pr-screenshots.mjs`
- **Manifest path** — `apps/web/tests/.pr-screenshots.json` (gitignored)
- **Spec file** — `apps/web/tests/pr-screenshots.spec.ts`
- **Playwright invocation**:
  ```bash
  pnpm --filter web exec playwright test tests/pr-screenshots.spec.ts \
    --project=desktop-dark --workers=1
  ```
  Use `--project=mobile` for a 390×844 viewport. Run both sequentially
  if the change is responsive-sensitive.
- **Default route list** (when shared components are touched and the
  user doesn't specify): `/home`, `/shows`, `/venues`, `/artists`,
  `/discover`, `/preferences`.
- **Route mapping** — `apps/web/app/(app)/<segment>/page.tsx` →
  `/<segment>`; `apps/web/app/(app)/<segment>/[id]/page.tsx` → ask
  the user for a representative id, or skip detail pages without one.

PNGs land in `apps/web/test-results/screenshots/`. Delete the
manifest after the run.

## Mobile flow (showbook-only)

The sandbox can't run iOS or KVM-backed Android, so mobile capture
happens on **Maestro Cloud** via the `mobile-e2e` workflow. The
workflow is gated on the `mobile-visual` PR label.

### 1. Add the label

```
mcp__github__issue_write { action: "add_labels", labels: ["mobile-visual"] }
```

This kicks off an EAS build + 3 Maestro flows on the PR. Cost: 1
EAS build + 3 flows per labelled PR (free tier handles ~30 PRs/month
combined). Re-labelling does NOT re-trigger — push a new commit to
re-run.

### 2. Hand back to creating-prs

The workflow:

- Builds the Expo app on EAS.
- Runs the Maestro Cloud flows.
- Edits a `## Mobile screenshots` section into the PR body itself,
  bracketed with `<!-- mobile-screenshots:start -->` and
  `<!-- mobile-screenshots:end -->` sentinels for clean replacement
  on re-runs.

Since `creating-prs` is already subscribed to PR activity, the user
sees the workflow finish and the body update arrive as webhook
events.

### 3. When NOT to run mobile

- Diff doesn't touch `apps/mobile/{app,components}/**`. EAS build
  minutes are not free.
- The user explicitly only wants web captures.

## Anti-patterns (showbook-specific, additive to the base)

- Manually attaching mobile screenshots from a teammate's device —
  the Maestro Cloud capture is reproducible; ad-hoc captures aren't.
- Re-running the mobile workflow without removing the label first
  when the user only wanted one capture — burns EAS minutes.
- Committing `apps/web/tests/.pr-screenshots.json` — it's gitignored
  for a reason.
