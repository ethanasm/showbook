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

export interface PreviewPlayerState {
  currentTrackKey: string | null;
  isPlaying: boolean;
}

export interface PreviewPlayerControllerOptions {
  driver: PlaybackDriver;
  /** Called every time `play` / `stop` mutates state. */
  onStateChange?: (state: PreviewPlayerState) => void;
}

export class PreviewPlayerController {
  private driver: PlaybackDriver;
  private onStateChange?: (state: PreviewPlayerState) => void;
  private state: PreviewPlayerState = {
    currentTrackKey: null,
    isPlaying: false,
  };

  constructor(opts: PreviewPlayerControllerOptions) {
    this.driver = opts.driver;
    this.onStateChange = opts.onStateChange;
  }

  getState(): PreviewPlayerState {
    return this.state;
  }

  /**
   * Begin playback for `handle`. When the row is already active, this
   * toggles to stop (matches the web contract). When no preview URL is
   * available, `onUnavailable` fires so the row can flip its glyph to
   * the disabled state and surface a toast.
   */
  async play(
    handle: PreviewHandle,
    onUnavailable?: () => void,
  ): Promise<void> {
    if (this.state.currentTrackKey === handle.key) {
      await this.stop();
      return;
    }
    await this.driver.stop().catch(() => undefined);
    if (!handle.previewUrl) {
      onUnavailable?.();
      return;
    }
    try {
      await this.driver.play(handle.previewUrl);
      this.setState({ currentTrackKey: handle.key, isPlaying: true });
    } catch {
      this.setState({ currentTrackKey: null, isPlaying: false });
      onUnavailable?.();
    }
  }

  async stop(): Promise<void> {
    await this.driver.stop().catch(() => undefined);
    this.setState({ currentTrackKey: null, isPlaying: false });
  }

  /**
   * Called when underlying audio finishes (e.g. the 30s clip ends).
   * The driver layer wires this to its on-ended callback so the row
   * flips back to the idle ▶ glyph.
   */
  handleEnded(): void {
    this.setState({ currentTrackKey: null, isPlaying: false });
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
