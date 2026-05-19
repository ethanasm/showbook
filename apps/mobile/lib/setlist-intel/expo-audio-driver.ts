/**
 * Real-audio `PlaybackDriver` backed by `expo-audio`. Used by the
 * `PreviewPlayerProvider` on iOS, Android, and the Expo web bundle.
 *
 * The driver lazily constructs a single `AudioPlayer` and swaps its
 * source via `replace(...)` so we hold exactly one audio element / one
 * native sound object per show-detail screen (single-stream contract).
 * When the clip ends naturally, the `playbackStatusUpdate` listener
 * fires `onEnded` so the consumer can flip the row glyph back to ▶.
 *
 * Lives outside `preview-player.ts` so the pure-node unit tests can
 * exercise the controller without dragging in the `expo-audio` native
 * module via a transitive import.
 *
 * `expo-audio` is loaded lazily via `require()` inside `ensurePlayer()`
 * instead of a top-level `import` so this file's module evaluation
 * never reaches `requireNativeModule('ExpoAudio')`. A dev client built
 * before #254 added the dep ships JS that references `expo-audio` but
 * has no registered native module, so the eager-import path threw
 * `Cannot find native module 'ExpoAudio'` while loading the show-detail
 * route — which `app/(tabs)/_layout.tsx` pulls in eagerly for the iPad
 * three-pane layout. Expo Router's route loader then saw an undefined
 * module and surfaced the failure as `Cannot read property
 * 'ErrorBoundary' of undefined` at the root error boundary, taking the
 * whole app down at cold start. Deferring the require keeps app boot
 * working on stale binaries; the preview button silently no-ops on the
 * old build until the user installs a fresh native build. Mirrors the
 * runtime probe pattern #256 used for `RNCMaskedView`.
 */

import type { PlaybackDriver } from './preview-player';

interface ExpoAudioModule {
  createAudioPlayer: (source: unknown) => ExpoAudioPlayer;
}

interface ExpoAudioPlayer {
  currentTime: number;
  replace: (source: { uri: string }) => void;
  play: () => void;
  pause: () => void;
  seekTo: (seconds: number) => Promise<void>;
  remove: () => void;
  addListener: (
    event: 'playbackStatusUpdate',
    cb: (status: { didJustFinish?: boolean }) => void,
  ) => { remove: () => void };
}

let _expoAudioCache: ExpoAudioModule | null | undefined = undefined;

function loadExpoAudio(): ExpoAudioModule | null {
  if (_expoAudioCache !== undefined) return _expoAudioCache;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _expoAudioCache = require('expo-audio') as ExpoAudioModule;
  } catch {
    _expoAudioCache = null;
  }
  return _expoAudioCache;
}

/** Test hook: reset the cached `expo-audio` reference between cases. */
export function __resetExpoAudioCacheForTest(): void {
  _expoAudioCache = undefined;
}

export interface ExpoAudioDriverOptions {
  /** Fires when the clip finishes playing on its own. */
  onEnded?: () => void;
}

export class ExpoAudioDriver implements PlaybackDriver {
  private player: ExpoAudioPlayer | null = null;
  private subscription: { remove: () => void } | null = null;
  private currentSrc: string | null = null;
  private readonly onEnded?: () => void;

  constructor(opts: ExpoAudioDriverOptions = {}) {
    this.onEnded = opts.onEnded;
  }

  async play(url: string): Promise<void> {
    const player = this.ensurePlayer();
    if (!player) return;
    if (this.currentSrc !== url) {
      player.replace({ uri: url });
      this.currentSrc = url;
    } else if (player.currentTime > 0) {
      // Replaying the same clip: rewind so the second tap restarts at 0.
      await player.seekTo(0).catch(() => undefined);
    }
    player.play();
  }

  async stop(): Promise<void> {
    const player = this.player;
    if (!player) return;
    try {
      player.pause();
    } catch {
      // pause() can throw if the player is mid-release; swallow.
    }
  }

  async dispose(): Promise<void> {
    if (this.subscription) {
      try {
        this.subscription.remove();
      } catch {
        // listener already torn down — fine.
      }
      this.subscription = null;
    }
    if (this.player) {
      try {
        this.player.remove();
      } catch {
        // release() races with the runtime's GC on unmount in some
        // RN versions; the second remove is harmless.
      }
      this.player = null;
    }
    this.currentSrc = null;
  }

  private ensurePlayer(): ExpoAudioPlayer | null {
    if (this.player) return this.player;
    const audio = loadExpoAudio();
    if (!audio) return null;
    const player = audio.createAudioPlayer(null);
    this.subscription = player.addListener(
      'playbackStatusUpdate',
      (status) => {
        if (status.didJustFinish) {
          this.onEnded?.();
        }
      },
    );
    this.player = player;
    return player;
  }
}
