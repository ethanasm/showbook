/**
 * In-code feature flag registry. Flag state is set here and changed by PR.
 * No env vars; no remote config. Only medium/high risk features get a
 * flag — low-risk additive changes ship unflagged.
 *
 * Lifecycle: land as 'OFF' with the no-op branch matching current
 * behaviour; flip to 'ON' after dev/E2E validation; delete the flag and
 * its OFF branch in a cleanup PR after a clean week in Axiom.
 *
 * State values:
 *   - `'ON'`       — feature enabled for every caller.
 *   - `'OFF'`      — feature disabled for every caller.
 *   - `'DEV_ONLY'` — enabled only when the caller's email matches the
 *                    operator allowlist (`ADMIN_EMAILS` env, parsed by
 *                    `@showbook/api`'s `isAdminEmail`). Used while a
 *                    feature is mid-rollout and the developer wants to
 *                    dogfood without exposing to other users.
 */
export type FeatureFlagState = 'ON' | 'OFF' | 'DEV_ONLY';

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
      'design handoff. While DEV_ONLY, only operators in ADMIN_EMAILS ' +
      'see the new layout; everyone else keeps the legacy page. Flip ' +
      'to ON once the algorithm + jobs have run cleanly for 7 days.',
    state: 'DEV_ONLY',
  },
} as const satisfies Record<string, { description: string; state: FeatureFlagState }>;

export type FeatureFlagKey = keyof typeof FeatureFlag;

/**
 * Static `ON`/`OFF` check. For per-user `DEV_ONLY` gating use
 * `isFeatureOnFor` and pass the caller's email.
 */
export function isFeatureOn(key: FeatureFlagKey): boolean {
  return FeatureFlag[key].state === 'ON';
}

/**
 * Per-caller resolution. Returns true when the flag is `ON`, or when
 * the flag is `DEV_ONLY` and `isDev` resolves to true for this user.
 * Callers pass `isDev` because the consumer-side knows how to evaluate
 * "is this caller a developer" (web: check the NextAuth session email
 * against `ADMIN_EMAILS`; jobs: pass a hard-coded developer user id).
 */
export function isFeatureOnFor(
  key: FeatureFlagKey,
  isDev: boolean,
): boolean {
  const state = FeatureFlag[key].state;
  if (state === 'ON') return true;
  if (state === 'OFF') return false;
  return isDev;
}
