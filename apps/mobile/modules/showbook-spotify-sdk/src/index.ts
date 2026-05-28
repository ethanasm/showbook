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

// `requireNativeModule` throws when the native side isn't linked,
// which is exactly what we want on the web bundle (Metro's platform
// resolution will pick `index.web.ts` for that target instead).
export default requireNativeModule<ShowbookSpotifySDK>('ShowbookSpotifyModule');
