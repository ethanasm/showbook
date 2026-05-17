/**
 * In-code feature flag registry. Flag state is set here and changed by PR.
 * No env vars; no remote config. Only medium/high risk features get a
 * flag — low-risk additive changes ship unflagged.
 *
 * Lifecycle: land as 'OFF' with the no-op branch matching current
 * behaviour; flip to 'ON' after dev/E2E validation; delete the flag and
 * its OFF branch in a cleanup PR after a clean week in Axiom.
 */
export const FeatureFlag = {
  GmailScanPdfAttachments: {
    description:
      "R1 — fall back to PDF attachment extraction when the email body extract is null or low-confidence.",
    state: 'ON',
  },
  GmailScanHeuristicGate: {
    description:
      "P1 — pre-LLM regex/keyword scorer that skips obvious junk before any Groq call.",
    state: 'ON',
  },
  GmailScanCrossScanDedup: {
    description:
      "P4 — skip messages whose gmailMessageId is already referenced by one of the user's saved shows.",
    state: 'ON',
  },
  SpotifyAudioFeaturesAvailable: {
    description:
      'Phase 8 hard-gate (setlist-intelligence). Spotify deprecated ' +
      '/audio-features for new applications in late 2024. ON means our ' +
      'app registration was grandfathered and Phase 8 (vibe radar / ' +
      'energy arc) ships natively. OFF means denied — Phase 8 drops ' +
      'from v1 per SI-16 (AcousticBrainz fallback was rejected, frozen ' +
      'at 2022). Decided by the operator running `pnpm --filter ' +
      '@showbook/api probe-audio-features <userId>` once after Spotify ' +
      'connects; flipped ON via PR if the probe returns 200.',
    state: 'OFF',
  },
  SetlistIntelShowTabs: {
    description:
      'Phase 1 (setlist-intelligence) show-page redesign. Replaces the ' +
      'legacy vertical-stack /(app)/shows/[id]/ layout with the 4-tab ' +
      '(Overview / Setlist / Media / Notes) shell from the 2026-05-16 ' +
      'design handoff. Flip back to OFF if the tab system causes a ' +
      "regression we can't fix in-place; the legacy page renders " +
      'against the same `shows.detail` payload.',
    state: 'ON',
  },
  SetlistIntelSongs: {
    description:
      'Phase 2 (setlist-intelligence) songs surface. Gates the /(app)/songs ' +
      'index + per-song detail pages, the Songs section on artist detail, ' +
      'and the inline 🆕 / 🎯 badges on the Setlist tab. Showbook is a ' +
      "single-user app so 'ON' for the developer's user id is equivalent " +
      'to ON globally; flip OFF before broader rollout if the song-index ' +
      'matview falls behind and badges go stale.',
    state: 'ON',
  },
  SetlistIntelHypePlaylist: {
    description:
      'Phase 3 (setlist-intelligence) hype/heard playlist export. ' +
      'Replaces the P1 HypePlaylistCard placeholder with the real ' +
      'Spotify-backed card on the Setlist tab + desktop right rail, ' +
      'and enables `spotify.createHypePlaylist` / ' +
      '`spotify.createHeardPlaylist` tRPC mutations. Per SI-05 option ' +
      'C, ships without the rotating-style hide rule — rotating fans ' +
      '(Phish, etc.) get a low-relevance card in the Phase 3 → Phase 5 ' +
      'window, which Phase 5 closes. ADMIN_EMAILS still bypasses the ' +
      'gate, but is a no-op now that the flag is ON globally. Flip ' +
      'OFF if the Spotify mutations regress in prod (mis-ordered ' +
      'tracks, duplicate playlists, scope-probe false positives) — ' +
      'the placeholder absorbs taps with disabled CTAs.',
    state: 'ON',
  },
  SetlistIntelPreviews: {
    description:
      'Phase 9 (setlist-intelligence) 30-second preview buttons on ' +
      'every setlist track row + the Spotify-follow rail on Discover ' +
      "Artists tab. OFF leaves Phase-1's empty 24px slot in place and " +
      'hides the rail entirely; ON wires both surfaces. Web Playback ' +
      'SDK for full-track playback (Premium-only) is gated by this ' +
      'flag too — non-Premium users always get the 30s preview when ' +
      'the flag is ON. Flip OFF if the playback context regresses ' +
      '(rows fail to stop the previous track, audio element leaks, ' +
      "Web Playback SDK crashes on Premium accounts) — the row's " +
      'data-testid="predicted-row-preview-slot" stays the same so the ' +
      'rollback is invisible to E2E.',
    state: 'ON',
  },
  SetlistIntelEvalHarness: {
    description:
      'Phase 4 (setlist-intelligence) eval-harness admin surface. ' +
      'Gates the /admin/eval page that renders the 30-day Brier + P@10 ' +
      'chart, calibration curve, and per-show breakdown. The pg-boss ' +
      'eval back-test job runs in all envs regardless of this flag — ' +
      'we need the data on disk before flipping the release gate in ' +
      "Phase 5. Single-user app, so 'ON' is equivalent to ON for the " +
      'developer; admin allowlist is the actual gate. Flip OFF if the ' +
      'page regresses (DB calls fall over, chart math wrong) — the ' +
      'backtest cron keeps writing rows in the background.',
    state: 'ON',
  },
  SetlistIntelStyleClassifier: {
    description:
      'Phase 5 (setlist-intelligence) — gates running the §15b style ' +
      'classifier on the prediction path. When OFF, every performer ' +
      "falls back to 'stable' archetype and the stable §4c algorithm " +
      'serves every prediction. When ON, predictedSetlistCached branches ' +
      'on the performer\'s setlistStyle and the rotating variant is ' +
      'served for rotating-classified performers (subject to the ' +
      'SetlistIntelRotatingDisplay flag + release-gate check on the ' +
      "client). Default ON. Flip OFF if the classifier misbehaves — " +
      'every artist will look "stable" but predictions stay correct ' +
      'for that subset.',
    state: 'ON',
  },
  SetlistIntelRotatingDisplay: {
    description:
      'Phase 5 (setlist-intelligence) — gates the rotating-style ' +
      'predicted-setlist UI variant (gap chart + position pools + ' +
      'multi-night context banner). ON in single-user prod so the ' +
      'model can be tuned against real shows; the calibration ' +
      'release-gate (setlistIntel.releaseGate) still computes a ' +
      'verdict and emits setlist.release_gate.{passed,failed} ' +
      'observability events, but the client no longer hard-blocks ' +
      'the rotating UI when the gate fails. Flip OFF if rotating ' +
      'shows a regression that takes longer than a deploy cycle to ' +
      'fix; stable display is unaffected.',
    state: 'ON',
  },
  SetlistIntelTheatricalDisplay: {
    description:
      'Phase 6 (setlist-intelligence) — gates the theatrical-style ' +
      'predicted-setlist UI variant (ActDivider + RotatingSlotCard, ' +
      'served when prediction.style === "theatrical"). Default ON in ' +
      'single-user prod so the model can be tuned against real shows; ' +
      'the calibration release-gate still computes a verdict and ' +
      'emits setlist.release_gate.{passed,failed}, but the client no ' +
      'longer hard-blocks on it. When OFF, theatrical-classified ' +
      'performers fall through to SetlistTabComingSoon.',
    state: 'ON',
  },
  SetlistIntelImprovisedDisplay: {
    description:
      'Phase 6 (setlist-intelligence) — gates the improvised-style ' +
      'predicted-setlist UI variant (VibeSketchCard + ShowModeOddsCard, ' +
      'served when prediction.style === "improvised"). Default ON in ' +
      'single-user prod for the same reason as the theatrical flag. ' +
      "The release-gate's improvised_show_mode_calibration breach is " +
      'still emitted to Axiom for tuning. When OFF, improvised-' +
      'classified performers fall through to SetlistTabComingSoon.',
    state: 'ON',
  },
  SetlistIntelMusicLayerV2: {
    description:
      'Phase 7 (setlist-intelligence) music layer v2. Gates the ' +
      'fan-loyalty ring on the Overview tab + desktop right rail, the ' +
      "discovered-live rail on the Setlist tab, and the show-title " +
      "priming-stat italic. Single-user prod so 'ON' is equivalent to " +
      'ON for the developer; flip OFF if the recently-played + ' +
      'year-end-soundtrack jobs regress or the per-show ' +
      '/me/tracks/contains call rate-limits Spotify.',
    state: 'ON',
  },
  SetlistIntelMobileV2: {
    description:
      'Phase 10 (setlist-intelligence) mobile parity. Gates the new ' +
      '4-tab (Overview / Setlist / Media / Notes) show-detail layout on ' +
      'the Expo app, plus the iPad three-pane right rail wiring. OFF ' +
      'renders the legacy vertical-stack ShowDetailScreen; ON renders ' +
      'the 4-tab shell and routes the four prediction styles into the ' +
      'Setlist tab. Default OFF until the C3 physical-iPhone Spotify ' +
      'smoke test in the Phase 10 PR is signed off.',
    state: 'ON',
  },
} as const satisfies Record<string, { description: string; state: 'ON' | 'OFF' }>;

export type FeatureFlagKey = keyof typeof FeatureFlag;

export function isFeatureOn(key: FeatureFlagKey): boolean {
  return FeatureFlag[key].state === 'ON';
}
