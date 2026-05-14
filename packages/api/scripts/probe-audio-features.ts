/**
 * Operator runbook step for the end of Phase 0 of setlist-intelligence.
 *
 * Spotify deprecated the `audio-features` endpoint for new applications
 * in late 2024. Showbook's existing app registration (the same one that
 * powers `user-follow-read` artist import) may or may not have been
 * grandfathered. Phase 8 (vibe radar / energy arc / set-length) is
 * hard-gated on this probe result per SI-16:
 *
 *   200 OK  → access intact. Phase 8 ships natively.
 *   403     → access denied. Phase 8 is dropped from v1; ship in v2 only
 *             when a viable data source exists (AcousticBrainz is frozen
 *             at 2022 and won't cover current music).
 *
 * The probe needs a real connected Spotify token, so it can't run at
 * deploy time. The operator runs this script once after their own
 * Spotify connects, captures the result, and flips the in-code
 * `FeatureFlag.SpotifyAudioFeaturesAvailable` (in
 * `packages/shared/src/feature-flags.ts`) via PR. Phase 8's job
 * reads `isFeatureOn('SpotifyAudioFeaturesAvailable')` at job
 * start. Per repo convention, feature decisions live in code and
 * change by PR (not env vars / remote config) — see the header of
 * `feature-flags.ts`.
 *
 * Usage:
 *
 *   pnpm --filter @showbook/api probe-audio-features <userId>
 *
 * where `<userId>` is the Showbook user id of a user who has
 * connected Spotify. Look it up with:
 *
 *   SELECT id FROM users WHERE email = '<your email>';
 *
 * Requires DATABASE_URL and TOKEN_KEY in the environment (same as
 * any code path that decrypts a persisted Spotify token).
 *
 * The track ID hardcoded below is The Killers' "Mr. Brightside" —
 * picked because it's been on Spotify for ~15 years and is the
 * single most-played track on the platform, so the lookup itself
 * isn't a coverage edge case. If access is denied for "Mr.
 * Brightside" it's denied for everything.
 */

import { ensureFreshUserToken } from '../src/spotify-tokens';

const PROBE_TRACK_ID = '3n3Ppam7vgaVa1iaRUc9Lp'; // The Killers — Mr. Brightside

async function main(): Promise<void> {
  const userId = process.argv[2];
  if (!userId) {
    console.error(
      'usage: pnpm --filter @showbook/api probe-audio-features <userId>',
    );
    process.exit(2);
  }

  console.log(`[probe] resolving access token for user ${userId}…`);
  const accessToken = await ensureFreshUserToken(userId);
  if (!accessToken) {
    console.error(
      `[probe] user ${userId} has no connected Spotify token (or it's revoked). ` +
        `Connect Spotify in Preferences first, then re-run.`,
    );
    process.exit(2);
  }

  console.log(`[probe] calling GET /v1/audio-features/${PROBE_TRACK_ID}…`);
  const res = await fetch(
    `https://api.spotify.com/v1/audio-features/${PROBE_TRACK_ID}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
    },
  );

  const body = await res.text();
  console.log(`[probe] status=${res.status}`);
  console.log(`[probe] body  =${body.slice(0, 500)}`);

  if (res.status === 200) {
    console.log('');
    console.log('[probe] ✅ ACCESS INTACT.');
    console.log('[probe] Open a PR flipping the flag in');
    console.log('[probe]   packages/shared/src/feature-flags.ts');
    console.log('[probe] from:');
    console.log('');
    console.log('    SpotifyAudioFeaturesAvailable: { ..., state: \'OFF\' }');
    console.log('');
    console.log('[probe] to:');
    console.log('');
    console.log('    SpotifyAudioFeaturesAvailable: { ..., state: \'ON\' }');
    console.log('');
    console.log('[probe] Phase 8 (vibe radar) will ship natively once merged.');
    process.exit(0);
  }

  if (res.status === 403) {
    console.log('');
    console.log('[probe] ❌ ACCESS DENIED (Spotify deprecated for our app).');
    console.log('[probe] Leave the flag at its default in feature-flags.ts:');
    console.log('');
    console.log('    SpotifyAudioFeaturesAvailable: { ..., state: \'OFF\' }');
    console.log('');
    console.log(
      '[probe] Phase 8 (vibe radar / energy arc) will be DROPPED from v1 per SI-16.',
    );
    console.log(
      '[probe] AcousticBrainz fallback was rejected — frozen at 2022, ~100% miss for new music.',
    );
    console.log(
      '[probe] Revisit Phase 8 in v2 if a viable third-party data source is identified.',
    );
    process.exit(0);
  }

  // Transient error (5xx, 429, network etc.). Don't gate on a single
  // bad call; the operator should re-run.
  console.error('');
  console.error(`[probe] ⚠️  unexpected status ${res.status} — try again.`);
  console.error('[probe] do NOT flip the feature flag based on this run.');
  process.exit(1);
}

main().catch((err) => {
  console.error('[probe] failed:', err);
  process.exit(1);
});
