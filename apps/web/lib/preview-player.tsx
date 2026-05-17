"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Phase 9 of setlist-intelligence — single-stream preview player.
 *
 * One audio element per page. Tapping ▶ on row B stops row A. Premium
 * users that have wired the Web Playback SDK can register a `fullTrack`
 * driver; for everyone else, the 30-second `previewUrl` plays via the
 * shared `<audio>` element.
 *
 * The contract:
 *   - `play(handle)` — start a new row. If `handle.previewUrl` is null
 *     AND no full-track driver is wired, calls onUnavailable; the row's
 *     UI should fall back to the disabled "no preview" tooltip state.
 *   - `stop()` — stop whatever's currently playing.
 *   - `currentTrackKey` — the `key` of the row that's playing (or null).
 *     Rows use this to flip the play glyph to the animated waveform.
 *
 * The provider deliberately holds zero React state in fast paths
 * (audio events + driver callbacks) so the playback loop doesn't
 * thrash render. The single piece of state is `currentTrackKey`,
 * which fires once per row swap.
 */

export interface PreviewHandle {
  /**
   * Stable id for the row — usually `${showId}:${title.toLowerCase()}`.
   * The provider uses it to drive the active-row indicator and to
   * dedupe a tap on the row that's already playing.
   */
  key: string;
  /** 30s preview clip URL. Null when Spotify has no preview. */
  previewUrl: string | null;
  /** Spotify track id, when known. Used by the Web Playback SDK driver. */
  spotifyTrackId: string | null;
  /** Optional friendly label surfaced in logs / observability. */
  label?: string;
}

/**
 * Full-track playback driver — implemented by the Web Playback SDK
 * lazy-loader for Premium users. When set, `play` prefers full-track
 * over the 30s preview.
 */
export interface FullTrackDriver {
  /**
   * Play the given Spotify URI through whatever transport this driver
   * manages. Returns a promise that resolves once playback started.
   * Throwing causes the provider to fall back to the 30s preview.
   */
  play: (spotifyTrackId: string) => Promise<void>;
  /** Pause/stop whatever's playing. */
  stop: () => Promise<void>;
}

interface PreviewPlayerContextValue {
  /**
   * Begin playback for the given handle. Stops the previously-playing
   * row first (single-stream contract). When the row has no preview
   * AND no full-track driver to fall back to, the optional
   * `onUnavailable` callback fires so the caller can surface a toast.
   */
  play: (
    handle: PreviewHandle,
    onUnavailable?: () => void,
  ) => Promise<void>;
  /** Stop the current row, if any. Idempotent. */
  stop: () => void;
  /** Currently-playing row's `key`, or null when idle. */
  currentTrackKey: string | null;
  /** True while the active row is loading or playing. */
  isPlaying: boolean;
  /**
   * Register a Web Playback SDK driver. Returns a teardown.
   * If `null` is passed, removes the previous driver.
   */
  setFullTrackDriver: (driver: FullTrackDriver | null) => void;
  /** Whether a full-track driver is registered (Premium connected). */
  hasFullTrackDriver: boolean;
}

const PreviewPlayerContext = createContext<PreviewPlayerContextValue | null>(
  null,
);

/**
 * Mount once per page (or app) — children render the rows that call
 * `usePreviewPlayer().play(...)`. SSR-safe: the audio element is
 * created on the first client play.
 */
export function PreviewPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const driverRef = useRef<FullTrackDriver | null>(null);
  const [currentTrackKey, setCurrentTrackKey] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasFullTrackDriver, setHasFullTrackDriver] = useState(false);

  // Lazy-create the audio element. Browsers throttle creation off the
  // main thread, so we wait until first play().
  const getAudio = useCallback((): HTMLAudioElement => {
    if (audioRef.current) return audioRef.current;
    const el = new Audio();
    el.preload = "auto";
    el.crossOrigin = "anonymous";
    el.addEventListener("ended", () => {
      setCurrentTrackKey(null);
      setIsPlaying(false);
    });
    el.addEventListener("error", () => {
      setCurrentTrackKey(null);
      setIsPlaying(false);
    });
    el.addEventListener("pause", () => {
      // `pause` fires when we explicitly stop, when src changes, or
      // when playback ends. Drop isPlaying so the row glyph resets.
      setIsPlaying(false);
    });
    audioRef.current = el;
    return el;
  }, []);

  const stop = useCallback(() => {
    const el = audioRef.current;
    if (el && !el.paused) {
      el.pause();
    }
    const driver = driverRef.current;
    if (driver) {
      void driver.stop().catch(() => {
        // Driver stop failures are non-fatal — the new play() call
        // either replaces the stream or the row's UI reverts.
      });
    }
    setCurrentTrackKey(null);
    setIsPlaying(false);
  }, []);

  const play = useCallback<PreviewPlayerContextValue["play"]>(
    async (handle, onUnavailable) => {
      // Tap on the row that's already playing → stop (toggle).
      if (currentTrackKey === handle.key) {
        stop();
        return;
      }

      // Stop previous playback (single-stream contract).
      stop();

      const driver = driverRef.current;
      if (driver && handle.spotifyTrackId) {
        try {
          await driver.play(handle.spotifyTrackId);
          setCurrentTrackKey(handle.key);
          setIsPlaying(true);
          return;
        } catch {
          // Driver failed — fall through to preview branch.
        }
      }

      if (!handle.previewUrl) {
        onUnavailable?.();
        return;
      }

      const el = getAudio();
      el.src = handle.previewUrl;
      try {
        await el.play();
        setCurrentTrackKey(handle.key);
        setIsPlaying(true);
      } catch {
        // Autoplay rejected or src load failed.
        setCurrentTrackKey(null);
        setIsPlaying(false);
        onUnavailable?.();
      }
    },
    [currentTrackKey, getAudio, stop],
  );

  const setFullTrackDriver = useCallback(
    (driver: FullTrackDriver | null) => {
      driverRef.current = driver;
      setHasFullTrackDriver(!!driver);
      // If the driver disappears while a row is playing through it,
      // the easiest cleanup is to stop everything.
      if (!driver && currentTrackKey) {
        stop();
      }
    },
    [currentTrackKey, stop],
  );

  // Tear down audio on unmount so the provider can be remounted in
  // tests / route transitions without leaking the element.
  useEffect(() => {
    return () => {
      const el = audioRef.current;
      if (el) {
        el.pause();
        el.src = "";
      }
      audioRef.current = null;
    };
  }, []);

  const value = useMemo<PreviewPlayerContextValue>(
    () => ({
      play,
      stop,
      currentTrackKey,
      isPlaying,
      setFullTrackDriver,
      hasFullTrackDriver,
    }),
    [play, stop, currentTrackKey, isPlaying, setFullTrackDriver, hasFullTrackDriver],
  );

  return (
    <PreviewPlayerContext.Provider value={value}>
      {children}
    </PreviewPlayerContext.Provider>
  );
}

/**
 * Read-only access to the active row + the `play`/`stop` controls.
 * Throws when the provider isn't mounted so a missed provider in a
 * test or new page is loud rather than silent.
 */
export function usePreviewPlayer(): PreviewPlayerContextValue {
  const ctx = useContext(PreviewPlayerContext);
  if (!ctx) {
    throw new Error(
      "usePreviewPlayer must be used within a <PreviewPlayerProvider>",
    );
  }
  return ctx;
}

/**
 * Optional non-throwing variant for components that can render either
 * inside or outside the provider (e.g. the TrackPreview button is
 * used both on the show-page setlist rows AND on the discover rail).
 */
export function useMaybePreviewPlayer(): PreviewPlayerContextValue | null {
  return useContext(PreviewPlayerContext);
}
