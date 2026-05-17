"use client";

/**
 * Phase 9 of setlist-intelligence — lazy-loader for the Spotify Web
 * Playback SDK. Only Premium users get full-track playback; everyone
 * else falls back to the 30-second preview managed by
 * `preview-player.tsx`. The SDK itself is loaded on-demand the first
 * time a Premium user mounts the show page, so non-Premium pages
 * never pay the script-load cost.
 *
 * The SDK exposes a `Spotify.Player` global. We wrap it in a thin
 * `FullTrackDriver` shape and hand it to the PreviewPlayer context
 * so a tap on a row prefers the full track when available and
 * gracefully degrades to the preview on failure.
 *
 * Requires HTTPS (no localhost dev) — Playwright's E2E dev server
 * uses --experimental-https, prod is behind Cloudflare Tunnel, so
 * the browser policy is satisfied in every environment that ever
 * sees a Premium account.
 */

import type { FullTrackDriver } from "./preview-player";

const SDK_SRC = "https://sdk.scdn.co/spotify-player.js";

type SpotifyPlayerCtor = new (options: {
  name: string;
  getOAuthToken: (cb: (token: string) => void) => void;
  volume?: number;
}) => SpotifyPlayerInstance;

interface SpotifyPlayerInstance {
  addListener: (
    event:
      | "ready"
      | "not_ready"
      | "player_state_changed"
      | "initialization_error"
      | "authentication_error"
      | "account_error"
      | "playback_error",
    cb: (payload: unknown) => void,
  ) => boolean;
  connect: () => Promise<boolean>;
  disconnect: () => void;
  pause: () => Promise<void>;
}

interface SpotifyGlobal {
  Player: SpotifyPlayerCtor;
}

declare global {
  interface Window {
    Spotify?: SpotifyGlobal;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

let sdkPromise: Promise<SpotifyGlobal> | null = null;

/**
 * Inject `<script src=…>` once. Subsequent calls return the same
 * promise. The SDK calls `window.onSpotifyWebPlaybackSDKReady` when
 * its global is wired, so we hook into that to know when
 * `window.Spotify` is usable.
 */
export function loadSpotifyPlaybackSdk(): Promise<SpotifyGlobal> {
  if (sdkPromise) return sdkPromise;
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Spotify SDK requires a browser context"));
  }
  if (window.Spotify) {
    sdkPromise = Promise.resolve(window.Spotify);
    return sdkPromise;
  }
  sdkPromise = new Promise<SpotifyGlobal>((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) resolve(window.Spotify);
      else reject(new Error("Spotify SDK loaded without window.Spotify"));
    };
    const tag = document.createElement("script");
    tag.src = SDK_SRC;
    tag.async = true;
    tag.onerror = () => reject(new Error("Spotify SDK script failed to load"));
    document.body.appendChild(tag);
  });
  return sdkPromise;
}

export interface PlayerInitOptions {
  /**
   * Resolve a fresh Spotify access token. Called both at first
   * connect AND whenever the SDK asks for a refresh — must return a
   * usable token each call. Wire this through the user's persisted
   * token rather than letting the SDK hold one statically.
   */
  getAccessToken: () => Promise<string>;
  /**
   * Optional callback when the SDK device id is ready. Useful for
   * surfacing "Now playing on Showbook web" affordances elsewhere
   * in the UI, but not required for basic playback.
   */
  onReady?: (deviceId: string) => void;
  /**
   * Called on a fatal SDK error (auth, account, init) so the caller
   * can surface a re-connect modal. The driver hands itself back
   * via `setFullTrackDriver(null)` automatically before this fires.
   */
  onFatal?: (reason: string) => void;
}

/**
 * Boot the SDK and return a `FullTrackDriver` for the PreviewPlayer
 * context. Premium-only — the caller should gate this on
 * `connectionStatus.product === 'premium'` before invoking.
 *
 * Returns null when the SDK couldn't load (CSP/network) so the
 * caller can fall back to preview-only mode.
 */
export async function initFullTrackDriver(
  opts: PlayerInitOptions,
): Promise<FullTrackDriver | null> {
  let sdk: SpotifyGlobal;
  try {
    sdk = await loadSpotifyPlaybackSdk();
  } catch {
    return null;
  }

  let deviceId: string | null = null;

  const player = new sdk.Player({
    name: "Showbook",
    getOAuthToken: (cb) => {
      void opts
        .getAccessToken()
        .then(cb)
        .catch(() => {
          opts.onFatal?.("token_unavailable");
        });
    },
    volume: 0.6,
  });

  player.addListener("ready", (raw) => {
    const payload = raw as { device_id?: string };
    deviceId = payload.device_id ?? null;
    if (deviceId) opts.onReady?.(deviceId);
  });
  player.addListener("not_ready", () => {
    deviceId = null;
  });
  player.addListener("initialization_error", () =>
    opts.onFatal?.("init_error"),
  );
  player.addListener("authentication_error", () =>
    opts.onFatal?.("auth_error"),
  );
  player.addListener("account_error", () => opts.onFatal?.("account_error"));

  const ok = await player.connect();
  if (!ok) {
    opts.onFatal?.("connect_failed");
    return null;
  }

  return {
    async play(spotifyTrackId: string): Promise<void> {
      if (!deviceId) {
        throw new Error("Web Playback SDK device not ready");
      }
      const token = await opts.getAccessToken();
      const res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uris: [`spotify:track:${spotifyTrackId}`],
          }),
        },
      );
      if (!res.ok && res.status !== 204) {
        throw new Error(`Spotify play failed: ${res.status}`);
      }
    },
    async stop(): Promise<void> {
      await player.pause().catch(() => undefined);
    },
  };
}

/** Test-only — clears the cached promise so a fresh load can be staged. */
export function __resetSpotifyPlaybackSdkForTests(): void {
  sdkPromise = null;
}
