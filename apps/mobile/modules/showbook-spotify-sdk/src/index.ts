/**
 * `showbook-spotify-sdk` — Expo Module bridging the Spotify iOS / Android
 * App Remote SDKs into a single TypeScript surface that mirrors the
 * shape the web side already uses for the Web Playback SDK driver
 * (`apps/web/lib/preview-player.tsx` → `FullTrackDriver`).
 *
 * Design notes:
 *  - The App Remote SDK on both platforms requires the Spotify app to
 *    be installed on the device. The native side handshakes with that
 *    app over IPC; this module never streams audio itself.
 *  - On-demand `play(uri)` is Premium-only. Free users get the shuffle
 *    fallback the Spotify app enforces — we surface that via the
 *    `connect` outcome rather than blocking client-side.
 *  - `connect()` takes the Showbook user's Spotify access token (minted
 *    by `spotify.playbackToken` on the server, same source the web
 *    Web Playback SDK uses). The native side passes it to
 *    `SPTConfiguration.accessToken` / `AuthorizationRequest` so the
 *    user doesn't see a second consent prompt.
 *  - All methods are best-effort and reject on failure. Callers should
 *    treat any rejection as "fall back to the deep-link / preview path"
 *    rather than treating it as a fatal error.
 *
 * The web bundle picks up `index.web.ts` via Metro's platform-extension
 * resolution; that file returns a no-op so the Playwright smoke loop
 * doesn't drag native module loaders into the browser context.
 *
 * Native implementation status: the Kotlin (`expo.modules.showbookspotify`)
 * and Swift (`ShowbookSpotifyModule`) classes are not yet authored. Until
 * they land, every native lookup throws `Cannot find native module …`,
 * which previously crashed the app at module-eval time because the
 * `requireNativeModule` call below ran at top level. We now defer the
 * lookup to first use and fall back to a no-op stub on failure, so the
 * `SpotifySdkMount` gate (`status.data.connected && product === premium`
 * → `isAvailable()` returns `false`) naturally routes every Premium tap
 * through the deep-link path until the native side is shipped.
 */

import { requireNativeModule } from 'expo-modules-core';

export interface ShowbookSpotifySDK {
  /**
   * Is the Spotify app installed on this device? `false` ⇒ the App
   * Remote SDK can't connect; caller should fall back to the deep-link
   * path (which opens `open.spotify.com` in the in-app browser as a
   * last resort).
   */
  isAvailable(): Promise<boolean>;

  /**
   * Hand the SDK a fresh access token and bring up the IPC link to
   * the Spotify app. Subsequent `play()` calls require this to have
   * resolved. Rejects with a descriptive error code when the Spotify
   * app refuses (not installed / token rejected / user denied
   * authorization / Premium gate when the SDK reports it client-side).
   */
  connect(accessToken: string): Promise<void>;

  /**
   * Tell the connected Spotify app to play the given track id (the
   * `spotify_track_id` we store in `songs.spotify_track_id`). The
   * native side prefixes `spotify:track:` internally so callers always
   * pass the bare id. Rejects when the SDK isn't connected, when the
   * track id is unknown to Spotify, or — for Free users — when the
   * SDK enforces shuffle-only and refuses on-demand play.
   */
  play(spotifyTrackId: string): Promise<void>;

  /** Pause playback in the Spotify app. Safe to call when nothing is playing. */
  pause(): Promise<void>;

  /** Tear down the IPC link. Idempotent. */
  disconnect(): Promise<void>;
}

const UNAVAILABLE_MESSAGE =
  'showbook-spotify-sdk: native module unavailable on this platform';

const STUB: ShowbookSpotifySDK = {
  isAvailable: async () => false,
  connect: async () => {
    throw new Error(UNAVAILABLE_MESSAGE);
  },
  play: async () => {
    throw new Error(UNAVAILABLE_MESSAGE);
  },
  pause: async () => {},
  disconnect: async () => {},
};

// Defer the native lookup until first access so a missing module
// (no Kotlin / Swift class registered) doesn't crash app startup.
// The previous top-level `requireNativeModule(...)` ran at module-eval
// time and threw "Cannot find native module 'ShowbookSpotifyModule'"
// during root-layout import, killing the process before any UI could
// render. Falling back to STUB keeps `SpotifySdkMount`'s "leave the
// driver unmounted on failure" branch on the table.
let resolved: ShowbookSpotifySDK | null = null;

function resolveModule(): ShowbookSpotifySDK {
  if (resolved) return resolved;
  try {
    resolved = requireNativeModule<ShowbookSpotifySDK>('ShowbookSpotifyModule');
  } catch {
    resolved = STUB;
  }
  return resolved;
}

const proxy: ShowbookSpotifySDK = {
  isAvailable: (...args) => resolveModule().isAvailable(...args),
  connect: (...args) => resolveModule().connect(...args),
  play: (...args) => resolveModule().play(...args),
  pause: (...args) => resolveModule().pause(...args),
  disconnect: (...args) => resolveModule().disconnect(...args),
};

export default proxy;
