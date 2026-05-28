/**
 * Phase 10 (Part B3) — single-stream preview player contract for mobile
 * setlist rows. Mirrors the web `apps/web/lib/preview-player.tsx`
 * contract:
 *  - One audio element per page; tapping ▶ on row B stops row A.
 *  - `play(handle)` plays the 30s preview clip when available.
 *  - `stop()` halts whatever is currently playing.
 *  - `currentTrackKey` flips so the active row's button can swap to
 *    the waveform indicator.
 *
 * The actual audio playback driver is injected so:
 *   - On native (iPhone / iPad) we can wire up `expo-av` /
 *     `expo-audio` when the dependency ships.
 *   - On the Playwright headless-web loop we plug in a no-op driver.
 *   - In tests the controller exposes a `setNowDriver(...)` hook for
 *     deterministic assertions.
 *
 * No React Native imports here — the React layer in
 * `TrackPreviewButton.tsx` adds the hook + provider over this state.
 */

export interface PreviewHandle {
  key: string;
  previewUrl: string | null;
  spotifyTrackId: string | null;
  /** Display label for the floating mini-player. Falls back to the key. */
  label?: string;
}

export interface PlaybackDriver {
  /** Start playing the URL. Resolves once playback has begun. */
  play(url: string): Promise<void>;
  /** Stop / pause playback. Idempotent. */
  stop(): Promise<void>;
  /** Tear down underlying resources (sound object, etc.). */
  dispose(): Promise<void>;
}

/**
 * Optional full-track driver that plays a specific Spotify track id
 * through an external runtime (Spotify App Remote SDK on mobile, Web
 * Playback SDK on web). Mirrors `apps/web/lib/preview-player.tsx`'s
 * `FullTrackDriver` shape so the controller's branching logic stays
 * cross-platform-isomorphic. The controller consults this driver
 * before falling back to the 30s preview URL — `play(spotifyTrackId)`
 * either resolves (the SDK is connected, the user is Premium, the
 * track id is in Spotify's catalog) or throws and the controller falls
 * through to the deep-link / preview-URL path.
 */
export interface FullTrackDriver {
  play(spotifyTrackId: string): Promise<void>;
  stop(): Promise<void>;
}

export interface PreviewPlayerState {
  /** Key of the currently-playing row, or null if nothing is playing. */
  currentTrackKey: string | null;
  /** Key of the row whose preview URL is being resolved, or null. */
  loadingKey: string | null;
  isPlaying: boolean;
  /** Label of the currently-playing row, surfaced by the mini-player. */
  currentLabel: string | null;
}

export interface PlayOptions {
  /**
   * Async resolver invoked when `handle.previewUrl` is null. Lets the
   * controller stay free of tRPC / network plumbing — the React layer
   * passes a closure that hits `setlistIntel.resolveTrackPreview` and
   * writes the result back into the React Query cache. Return value
   * mirrors the mutation's shape; only `previewUrl` is consumed by the
   * driver, `spotifyTrackId` is returned for the caller to persist.
   */
  resolve?: () => Promise<{
    previewUrl: string | null;
    spotifyTrackId: string | null;
  }>;
  /** Fires when no playable URL is reachable — even after `resolve`. */
  onUnavailable?: () => void;
}

export interface PreviewPlayerControllerOptions {
  driver: PlaybackDriver;
  /** Called every time `play` / `stop` mutates state. */
  onStateChange?: (state: PreviewPlayerState) => void;
}


const INITIAL_STATE: PreviewPlayerState = {
  currentTrackKey: null,
  loadingKey: null,
  isPlaying: false,
  currentLabel: null,
};

export class PreviewPlayerController {
  private driver: PlaybackDriver;
  private fullTrackDriver: FullTrackDriver | null = null;
  private onStateChange?: (state: PreviewPlayerState) => void;
  private state: PreviewPlayerState = { ...INITIAL_STATE };

  constructor(opts: PreviewPlayerControllerOptions) {
    this.driver = opts.driver;
    this.onStateChange = opts.onStateChange;
  }

  getState(): PreviewPlayerState {
    return this.state;
  }

  /**
   * Inject (or clear) the full-track driver. Called from
   * `FullTrackDriverMount` on `app/_layout.tsx` once the Spotify SDK
   * has handshaken successfully — gated on
   * `spotify.connectionStatus.product === 'premium'`. Pass `null` on
   * tear-down (component unmount, SDK fatal error, user disconnect) so
   * subsequent taps fall back to the preview-URL path.
   */
  setFullTrackDriver(driver: FullTrackDriver | null): void {
    this.fullTrackDriver = driver;
  }

  hasFullTrackDriver(): boolean {
    return this.fullTrackDriver !== null;
  }

  /**
   * Begin playback for `handle`. When the row is already active, this
   * toggles to stop (matches the web contract). When `handle.previewUrl`
   * is null and `options.resolve` is provided, the controller calls the
   * resolver while flipping `loadingKey` so the row can show a spinner;
   * the resolved URL (if any) is then handed straight to the driver.
   * When no playable URL is reachable, `onUnavailable` fires so the row
   * can mark itself disabled.
   */
  async play(
    handle: PreviewHandle,
    options: PlayOptions = {},
  ): Promise<void> {
    if (this.state.currentTrackKey === handle.key) {
      await this.stop();
      return;
    }
    await this.driver.stop().catch(() => undefined);

    let previewUrl = handle.previewUrl;
    if (!previewUrl && options.resolve) {
      this.setState({
        currentTrackKey: null,
        loadingKey: handle.key,
        isPlaying: false,
        currentLabel: null,
      });
      try {
        const resolved = await options.resolve();
        previewUrl = resolved.previewUrl;
      } catch {
        this.setState({ ...INITIAL_STATE });
        options.onUnavailable?.();
        return;
      }
      // Bail if another row started loading mid-resolve — that race
      // wins and this resolve is stale.
      if (this.state.loadingKey !== handle.key) return;
    }

    if (!previewUrl) {
      this.setState({ ...INITIAL_STATE });
      options.onUnavailable?.();
      return;
    }

    try {
      await this.driver.play(previewUrl);
      this.setState({
        currentTrackKey: handle.key,
        loadingKey: null,
        isPlaying: true,
        currentLabel: handle.label ?? null,
      });
    } catch {
      this.setState({ ...INITIAL_STATE });
      options.onUnavailable?.();
    }
  }

  /**
   * Hand a Spotify track id directly to the full-track driver (App
   * Remote SDK on mobile, Web Playback SDK on web). Resolves on
   * success, rejects on failure — the caller (`TrackPreviewButton`)
   * decides whether to fall through to deep-link / preview-URL paths.
   * The controller deliberately does NOT flip `currentTrackKey`: SDK
   * playback runs in the Spotify app, not in-app, so the mini-player
   * stays idle. A future polish pass can wire a "Playing on Spotify"
   * indicator into the controller's state.
   */
  async playFullTrack(spotifyTrackId: string): Promise<void> {
    if (!this.fullTrackDriver) {
      throw new Error('PreviewPlayerController: no full-track driver mounted');
    }
    // Stop any in-flight preview clip + reset state so the mini-player
    // doesn't keep a stale "playing" UI while audio is now in Spotify.
    await this.driver.stop().catch(() => undefined);
    this.setState({ ...INITIAL_STATE });
    await this.fullTrackDriver.play(spotifyTrackId);
  }

  async stop(): Promise<void> {
    await this.driver.stop().catch(() => undefined);
    this.setState({ ...INITIAL_STATE });
  }

  /**
   * Called when underlying audio finishes (e.g. the 30s clip ends).
   * The driver layer wires this to its on-ended callback so the row
   * flips back to the idle ▶ glyph.
   */
  handleEnded(): void {
    this.setState({ ...INITIAL_STATE });
  }

  async dispose(): Promise<void> {
    await this.driver.dispose().catch(() => undefined);
  }

  private setState(next: PreviewPlayerState): void {
    this.state = next;
    this.onStateChange?.(next);
  }
}

/**
 * Driver that satisfies the contract without producing audio — used by
 * the headless Playwright web loop and as a fallback when the native
 * audio module is unavailable. Records play attempts so the unit suite
 * can assert single-stream semantics deterministically.
 */
export class NoopPlaybackDriver implements PlaybackDriver {
  public playedUrls: string[] = [];
  public stops = 0;
  public disposed = false;
  async play(url: string): Promise<void> {
    this.playedUrls.push(url);
  }
  async stop(): Promise<void> {
    this.stops += 1;
  }
  async dispose(): Promise<void> {
    this.disposed = true;
  }
}
