# Setlist intelligence

Specs for predicting what an artist will play at an upcoming show,
surfacing rare-catch / tour-debut / songs-heard-most stats on past
shows, and the Spotify integration ("the music layer") that ties it
all to the user's listening life.

Shipped as a multi-phase rollout — see [`phases/`](phases/) for the
phase-by-phase implementation plan.

---

## Read order

For a fresh look at the feature, this order maps best to *how* you'd
use the docs:

1. **[`feature-plan.md`](feature-plan.md)** — the parent reference.
   Schema, jobs, algorithm (incl. tour-aware Bayesian probability
   model), tRPC procedures, mobile/tablet, deeper Spotify (§13), and
   the §15 self-audit that drove the four-style approach.
2. **[`worked-examples.md`](worked-examples.md)** — algorithm output
   for one artist per style (Tate McRae · Phish · Beyoncé · King
   Gizzard) against real setlist.fm data, with rendered ASCII UI
   mockups.
3. **[`ui-spec.md`](ui-spec.md)** — visual design: components, design-
   token reuse, layout, interaction states, mobile/iPad/web variants,
   editorial microcopy.
4. **[`music-layer.md`](music-layer.md)** — plain-language expansion
   of feature-plan §13 (Spotify integration). Same scope as the
   technical version; written for non-engineers.
5. **[`implementation.md`](implementation.md)** — the shipping plan
   that resolves prior open questions: connect Spotify once, persist
   the encrypted token, never prompt again. Eleven phases. Files,
   exit criteria, observability events, tests.
6. **[`phases/`](phases/)** — one doc per phase, each standalone
   enough to hand off without reading everything else.

---

## Phases at a glance

| # | Phase | Doc | ~Time | Critical path? |
|---|-------|-----|------|----------------|
| 0 | Foundation — schema + token infra + connect modal | [phase-00](phases/phase-00-foundation.md) | 1w | Yes |
| 1 | Predicted setlist algorithm — stable-style MVP | [phase-01](phases/phase-01-predicted-setlist-stable.md) | 2w | Yes |
| 2 | Songs page + per-song detail | [phase-02](phases/phase-02-songs-page.md) | 1w | After P1 |
| 3 | Hype + post-show playlist export | [phase-03](phases/phase-03-spotify-export.md) | 1w | After P0 |
| 4 | Eval harness + calibration | [phase-04](phases/phase-04-eval-harness.md) | 1w | Shadow after P1 |
| 5 | Style classifier + rotating display (Phish) | [phase-05](phases/phase-05-style-classifier-rotating.md) | 2w | After P4 |
| 6 | Theatrical + improvised displays | [phase-06](phases/phase-06-theatrical-improvised.md) | 1w | After P5 |
| 7 | Library sync + priming + year-end soundtrack | [phase-07](phases/phase-07-music-layer-v2.md) | 2w | After P0 |
| 8 | ~~Vibe radar + energy arc~~ — **DEFERRED v2** (probe 403, 2026-05-17) | [phase-08](phases/phase-08-vibe-radar.md) | — | Dropped per SI-16 |
| 9 | Spotify-follow rail + previews + Web Playback | [phase-09](phases/phase-09-follow-rail-previews.md) | 1w | After P0 |
| 10 | Mobile parity + iPad three-pane | [phase-10](phases/phase-10-mobile-parity.md) | 1w | After P3, P5, P6 |
| 11 | §15 polish (album-drop, special events, etc.) | [phase-11](phases/phase-11-polish.md) | 2w | Last |

Total: ~13 weeks single-developer (P8 deferred); ~5 weeks for v1
(P0–P3) with P1/P2/P3 in parallel after P0.

---

## The anchor decisions

These are the resolved choices that previously had multiple options.
Re-open via implementation.md §11 if any need to change:

- **Connect Spotify once.** All eight needed scopes batched into one
  OAuth dialog upfront. Persist encrypted tokens. Never re-prompt
  unless Spotify revokes.
- **Four setlist styles, four displays.** A single
  `<PredictedSetlist style={prediction.style} />` switcher mounts
  one of stable / rotating / theatrical / improvised. Same
  algorithm output type union, different React subtree.
- **One algorithm, four prediction models.** Stable uses the §4c
  Bayesian model; rotating uses §15c gap + position pools + multi-
  night anti-repeat; theatrical returns the deterministic setlist
  + surprise-slot rotations; improvised refuses song-by-song and
  surfaces show-mode + vibe sketch.
- **Eval-driven release gate.** §15q Brier ≤ 0.15 stable; precision-
  at-10 ≥ 0.4 rotating; calibration error ≤ 20pp per bin. Shadow
  mode through Phase 4; gate enforces from Phase 5.

---

## Cross-cutting references

- Repo-root `CLAUDE.md` — observability conventions, `<component>.<action>.<outcome>` event shape, the curated list of structured events. Phases add to this list.
- `apps/web/CLAUDE.md` — web app conventions; affects every UI surface in the plan.
- `apps/mobile/CLAUDE.md` — mobile conventions; affects every mobile surface in Phases 3, 7, 10.
- `showbook-specs/schema.md` — entity reference. Phase 0 extends this.
- `showbook-specs/data-sources.md` — sources reference. Phases 0/3/7/8/9 extend the Spotify entry.
