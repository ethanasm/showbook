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
 */

import { createAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';

import type { PlaybackDriver } from './preview-player';

export interface ExpoAudioDriverOptions {
  /** Fires when the clip finishes playing on its own. */
  onEnded?: () => void;
}

export class ExpoAudioDriver implements PlaybackDriver {
  private player: AudioPlayer | null = null;
  private subscription: { remove: () => void } | null = null;
  private currentSrc: string | null = null;
  private readonly onEnded?: () => void;

  constructor(opts: ExpoAudioDriverOptions = {}) {
    this.onEnded = opts.onEnded;
  }

  async play(url: string): Promise<void> {
    const player = this.ensurePlayer();
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

  private ensurePlayer(): AudioPlayer {
    if (this.player) return this.player;
    const player = createAudioPlayer(null);
    this.subscription = player.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        if (status.didJustFinish) {
          this.onEnded?.();
        }
      },
    );
    this.player = player;
    return player;
  }
}
