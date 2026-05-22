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
  EventbriteImportEnabled: {
    description:
      'Eventbrite OAuth + past-orders import flow. Gates every Eventbrite ' +
      'surface: the GetStartedHub onboarding door, the desktop / mobile ' +
      'import buttons + bottom-sheet entry + empty-state CTA on /logbook ' +
      'and /upcoming, the `?import=eventbrite` deep-link, and the ' +
      '/api/eventbrite, /api/eventbrite/callback, /api/eventbrite/scan ' +
      'routes (404 when OFF so attackers cannot even tell the routes ' +
      'exist). The Eventbrite client in @showbook/api stays compiled — ' +
      'flipping ON re-enables the feature without a code change once ' +
      'EVENTBRITE_CLIENT_ID / EVENTBRITE_CLIENT_SECRET are configured. ' +
      'Default OFF.',
    state: 'OFF',
  },
} as const satisfies Record<string, { description: string; state: 'ON' | 'OFF' }>;

export type FeatureFlagKey = keyof typeof FeatureFlag;

export function isFeatureOn(key: FeatureFlagKey): boolean {
  return (FeatureFlag[key].state as 'ON' | 'OFF') === 'ON';
}
