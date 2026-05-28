/**
 * Adapter from the native `showbook-spotify-sdk` Expo Module to the
 * controller's `FullTrackDriver` shape (see
 * `lib/setlist-intel/preview-player.ts`). Layered so the controller
 * stays free of native-module imports — tests can substitute a mock
 * driver via `controller.setFullTrackDriver(...)` without dragging
 * `requireNativeModule` into the unit-test loader.
 *
 *  - `connect()` is invoked once at mount time by `FullTrackDriverMount`
 *    after a Premium-gated `spotify.playbackToken` fetch.
 *  - `play(trackId)` / `stop()` satisfy the driver contract; both
 *    reject when the SDK isn't connected so the caller falls through
 *    to the deep-link / preview-URL chain in `TrackPreviewButton`.
 *  - `disconnect()` tears the IPC link down so the next mount starts
 *    from scratch (e.g. after the user toggles Premium off).
 *
 * Every lifecycle event lands as a `spotify.mobile_sdk.*` Axiom event
 * via the shared mobile telemetry sink. Field surface is kept tight —
 * reuse existing keys (`event`, `message`, `level`, `errCode`) so we
 * don't widen the Axiom 257-column cap.
 */

import type { FullTrackDriver } from './setlist-intel/preview-player';
import { reportClientEvent, describeError } from './telemetry';

export interface ShowbookSpotifySdkLike {
  isAvailable(): Promise<boolean>;
  connect(accessToken: string): Promise<void>;
  play(spotifyTrackId: string): Promise<void>;
  pause(): Promise<void>;
  disconnect(): Promise<void>;
}

export interface SpotifySdkDriver extends FullTrackDriver {
  connect(accessToken: string): Promise<boolean>;
  disconnect(): Promise<void>;
  isAvailable(): Promise<boolean>;
}

interface SpotifySdkError {
  code?: string;
  message?: string;
}

function errCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const candidate = err as SpotifySdkError;
  return candidate.code;
}

// Lazy default loader so importing this module on a binary without
// the native bits (e.g. the unit-test loader, the headless web bundle
// before Metro swaps in the shim) doesn't blow up at module eval —
// `requireNativeModule` only fires when the host actually invokes
// a method. Mirrors the deferred-import trick in `expo-audio-driver.ts`.
let cachedNativeSdk: ShowbookSpotifySdkLike | null = null;
function loadNativeSdk(): ShowbookSpotifySdkLike {
  if (cachedNativeSdk) return cachedNativeSdk;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('showbook-spotify-sdk');
  cachedNativeSdk = (mod.default ?? mod) as ShowbookSpotifySdkLike;
  return cachedNativeSdk;
}

export function createSpotifySdkDriver(
  sdkOverride?: ShowbookSpotifySdkLike,
): SpotifySdkDriver {
  const sdk = sdkOverride ?? loadNativeSdk();
  let connected = false;

  return {
    async isAvailable(): Promise<boolean> {
      try {
        return await sdk.isAvailable();
      } catch {
        return false;
      }
    },

    async connect(accessToken: string): Promise<boolean> {
      try {
        await sdk.connect(accessToken);
        connected = true;
        reportClientEvent({
          event: 'spotify.mobile_sdk.connected',
          message: 'Spotify App Remote SDK connected',
          level: 'warn',
        });
        return true;
      } catch (err) {
        connected = false;
        reportClientEvent({
          event: 'spotify.mobile_sdk.connect_failed',
          message: describeError(err),
          level: 'error',
          context: { errCode: errCode(err) },
        });
        return false;
      }
    },

    async play(spotifyTrackId: string): Promise<void> {
      if (!connected) {
        throw new Error('spotify-sdk-driver: not connected');
      }
      try {
        await sdk.play(spotifyTrackId);
        reportClientEvent({
          event: 'spotify.mobile_sdk.play',
          message: 'Played track via App Remote SDK',
          level: 'warn',
          context: { spotifyTrackId },
        });
      } catch (err) {
        reportClientEvent({
          event: 'spotify.mobile_sdk.play_failed',
          message: describeError(err),
          level: 'error',
          context: { spotifyTrackId, errCode: errCode(err) },
        });
        // Some errors invalidate the IPC link (Spotify backgrounded,
        // user signed out of Spotify, etc.). Flip the connected flag
        // off so subsequent calls fail fast and `FullTrackDriverMount`
        // can attempt a reconnect on the next foreground.
        if (errCode(err) === 'ERR_NOT_CONNECTED') {
          connected = false;
        }
        throw err;
      }
    },

    async stop(): Promise<void> {
      if (!connected) return;
      try {
        await sdk.pause();
      } catch (err) {
        reportClientEvent({
          event: 'spotify.mobile_sdk.pause_failed',
          message: describeError(err),
          level: 'warn',
          context: { errCode: errCode(err) },
        });
      }
    },

    async disconnect(): Promise<void> {
      try {
        await sdk.disconnect();
      } finally {
        connected = false;
        reportClientEvent({
          event: 'spotify.mobile_sdk.disconnected',
          message: 'Spotify App Remote SDK disconnected',
          level: 'warn',
        });
      }
    },
  };
}
