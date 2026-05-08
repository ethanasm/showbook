# Showbook Mobile — Testing Strategy

The mobile app does NOT mirror the web app's blanket 80% coverage gate. Web's logic is concentrated in `lib/` and routers; mobile is layout-heavy and a flat 80% gate would count `<Text style={...}>` lines as "coverage." Instead, we run a tiered strategy that gates the parts that have load-bearing logic and visual-reviews the rest.

## Tiers

| Tier | What | Where | Per PR? | Coverage gate |
|---|---|---|---|---|
| 1. Unit (lib only) | Pure logic — cache, sync, mutations, outbox, network, helpers, theme utils | `apps/mobile/lib/__tests__/**.test.ts` via `node:test` | Yes | **80% on `apps/mobile/lib/**`** (enabled after D-1 merges) |
| 2. Migration | Cache schema migrations apply cleanly + idempotently | `apps/mobile/lib/__tests__/cache/migration.test.ts` | Yes | (counted in tier 1) |
| 3. Component (selective) | Genuinely interactive components only — SegmentedControl, VenueTypeahead, SetlistRow drag-state, MediaTile tag toggle, Toast/Banner provider | `apps/mobile/components/__tests__/**.test.tsx` via `@testing-library/react-native` | Yes | None |
| 4. Integration (cache + fake tRPC) | Cache + sync + outbox round-trips against in-memory sqlite | `apps/mobile/lib/__tests__/**.integration.test.ts` | Yes | None |
| 5. E2E (Android, automated) | Sign-in, add show, sign-out — 3 flows max | `apps/mobile/e2e/**` via Maestro on a self-hosted Linux runner inside the prod WSL box | **Nightly + push-to-main**; per-PR is opt-in via the `mobile-visual` label | None |
| 6. E2E (iOS, manual) | Same 3 flows | Maestro against a Simulator on the dev Mac (`pnpm mobile:e2e:ios`) | Pre-push hygiene before merging mobile changes | None |

**No coverage gate on `apps/mobile/app/**` or `apps/mobile/components/**`.** Layout has no meaningful branches; visual review of PRs covers what coverage can't.

## Per-milestone test deliverables

| Branch | New test files |
|---|---|
| B-1 cache | `cache/migration.test.ts`, `cache/repo.test.ts`, `cache/sync.test.ts`, `cache/useCachedQuery.test.ts` (~80% on `lib/cache`) — **MERGED** |
| C-1 Home | None — pure layout |
| C-2 Shows | `CalendarGrid` test if extracted (date math is testable) |
| C-3 ShowDetail | None |
| C-4 Map | Bucket-clustering pure helper test |
| C-5 Me v2 | Density preference round-trip — **MERGED** |
| D-1 M3 | `mutations.test.ts`, `outbox.test.ts`, `outbox.integration.test.ts`, VenueTypeahead component test, SetlistRow component test |
| D-2 M4 | `media/upload.test.ts` (mock fetch), MediaTile component test |
| D-3 M5 | Search-debounce smoke; pure helpers if any |
| E-1 offline | `network.test.ts`, `outbox.integration.test.ts` (retry-on-reconnect path) |
| E-2 iPad | `responsive.test.ts` (breakpoint hook) |

## Wave F (TestFlight prep) — **COMPLETE**

- Maestro setup + 3 flows: sign-in, add show, sign-out — `apps/mobile/e2e/flows/`
- **Why Android-CI / iOS-manual:** Maestro Cloud is paid-only (free trial only, no free tier as of 2026-05). Apple hardware in this stack is the dev Mac, which isn't always on. The result:
  - **Android = automated.** Self-hosted GH Actions runner on the prod WSL box (always-on, free). `.github/workflows/mobile-e2e.yml` builds the APK on EAS (free tier covers nightly + push), boots the local AVD, installs the APK, runs Maestro flows. One-time runner setup is `scripts/setup-runner-android.sh` (Android SDK + AVD + Maestro CLI). Runs nightly + push-to-`main` + on PRs labeled `mobile-visual`.
  - **iOS = manual pre-push hygiene.** Boot Simulator on the Mac, run `pnpm mobile:e2e:ios` from the repo root (wrapper around `maestro test e2e/flows/`). The test surface is platform-shared in RN, so Android catches ~90% of regressions; iOS-only bugs (haptics, share sheets, native maps quirks) need a manual sweep regardless.
- E2E test mode: `EXPO_PUBLIC_E2E_MODE=1` baked into the `e2e` EAS profile (`apps/mobile/eas.json`); `lib/auth.ts` bypasses Google OAuth and reads a pre-seeded Showbook JWT from SecureStore (`e2e.test-token` + `e2e.test-user`). The bypass is gated on the env var so production builds keep the real OAuth path — see the `isE2EMode` test in `apps/mobile/lib/__tests__/auth.test.ts` for the explicit production-safety assertion.
- Pre-release smoke gate: the Android workflow can be triggered via `workflow_dispatch` before cutting a release. iOS gets a manual `pnpm mobile:e2e:ios` sweep at the same point.

## Coverage gate rollout

- **Now**: no gate; tests are best-effort per the per-milestone table above
- **After D-1 merges**: enable 80% gate on `apps/mobile/lib/**` only via `scripts/coverage-report.mjs`
- **After E-1 merges**: review whether the gate scope needs to extend to `apps/mobile/components/` (only the components in tier 3 — the rest stay unguarded)
- **Web's 80% gate stays unchanged.**

## Component test setup (when D-1 lands)

D-1 is the first branch needing component tests (SetlistRow drag, VenueTypeahead debounce). The setup it owns:

- Add `@testing-library/react-native` and `react-test-renderer` to `apps/mobile/devDependencies`
- Add a `tests/setup.ts` that mocks the native modules used in tested components (`expo-secure-store`, `expo-haptics`, etc.) — use `node:test --import` to register globally
- The existing `pnpm -F mobile test` script discovers `*.test.tsx` files alongside `*.test.ts`; no script change required

Skip jest. The repo's pattern is `node:test` with tsx, and it works for RN component tests via `@testing-library/react-native@13+` which exports a renderer-agnostic API.

## What we are deliberately NOT doing

- **No blanket 80% gate** — the web pattern doesn't fit
- **No visual regression / Storybook + Chromatic** — too much overhead for a small team; design fidelity is reviewed in PR
- **No Detox** — Maestro is lighter, YAML-driven, and good enough for the 3 critical flows
- **No per-PR E2E by default** — runs nightly + release only; per-PR is too slow for the default path. Devs can opt in on a per-PR basis with the `mobile-visual` label when they want an Android Maestro run + screenshot capture for visual review.
- **No Maestro Cloud** — paid-only, free trial only. The self-hosted runner replaces it for Android; iOS is intentionally manual.
- **No automated iOS e2e** — would require either an always-on Mac runner (the dev Mac isn't) or paid GH-hosted macOS minutes. Manual iOS via `pnpm mobile:e2e:ios` is the deliberate trade-off.
- **No screen-level unit tests for layout-only screens** — typecheck + visual review is enough
