/**
 * Phase 9 — `PreviewPlayerProvider` single-stream contract. Asserts:
 *   - tapping row B stops row A's playback
 *   - `currentTrackKey` flips to the new row
 *   - the audio element is reused (not re-created per row)
 *   - the optional `onUnavailable` callback fires when previewUrl
 *     is null and no full-track driver is wired
 *   - a registered `FullTrackDriver` is preferred over the preview
 *     when a spotifyTrackId is present, and its failure falls back
 *     to the 30s preview branch
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { act, renderHook, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import {
  PreviewPlayerProvider,
  usePreviewPlayer,
  type FullTrackDriver,
} from '../preview-player';

interface AudioCall {
  src?: string;
  paused: boolean;
}

let audioCalls: AudioCall[];
let lastInstance: FakeAudio | null;
let origAudio: typeof globalThis.Audio;

class FakeAudio {
  src = '';
  paused = true;
  // The Audio constructor in the browser accepts an optional URL arg.
  // jsdom calls Audio() with no args for the lazy-create path.
  constructor() {
    lastInstance = this;
  }
  preload = '';
  crossOrigin: string | null = null;
  private listeners: Record<string, Array<() => void>> = {};
  addEventListener(event: string, cb: () => void) {
    (this.listeners[event] ??= []).push(cb);
  }
  removeEventListener(event: string, cb: () => void) {
    const list = this.listeners[event] ?? [];
    this.listeners[event] = list.filter((fn) => fn !== cb);
  }
  emit(event: string) {
    for (const cb of this.listeners[event] ?? []) cb();
  }
  async play(): Promise<void> {
    this.paused = false;
    audioCalls.push({ src: this.src, paused: this.paused });
  }
  pause(): void {
    if (!this.paused) {
      this.paused = true;
      this.emit('pause');
    }
  }
}

function wrapper({ children }: { children: ReactNode }) {
  return <PreviewPlayerProvider>{children}</PreviewPlayerProvider>;
}

beforeEach(() => {
  audioCalls = [];
  lastInstance = null;
  origAudio = globalThis.Audio;
  (globalThis as unknown as { Audio: unknown }).Audio = FakeAudio;
});

afterEach(() => {
  (globalThis as unknown as { Audio: unknown }).Audio = origAudio;
  cleanup();
});

describe('PreviewPlayerProvider — single-stream contract', () => {
  it('tapping row B stops row A (single audio element reused)', async () => {
    const { result } = renderHook(() => usePreviewPlayer(), { wrapper });

    await act(async () => {
      await result.current.play({
        key: 'show:row-a',
        previewUrl: 'https://p/a.mp3',
        spotifyTrackId: null,
      });
    });

    const audioAfterA = lastInstance;
    assert.equal(result.current.currentTrackKey, 'show:row-a');
    assert.equal(result.current.isPlaying, true);
    assert.equal(audioCalls.length, 1);
    assert.equal(audioCalls[0]?.src, 'https://p/a.mp3');

    await act(async () => {
      await result.current.play({
        key: 'show:row-b',
        previewUrl: 'https://p/b.mp3',
        spotifyTrackId: null,
      });
    });

    // The same FakeAudio instance — we never construct a second one.
    assert.equal(lastInstance, audioAfterA);
    // The audio element was paused (row A stopped) then re-played (row B).
    assert.equal(result.current.currentTrackKey, 'show:row-b');
    assert.equal(audioCalls.length, 2);
    assert.equal(audioCalls[1]?.src, 'https://p/b.mp3');
  });

  it('tapping the active row stops playback (toggle off)', async () => {
    const { result } = renderHook(() => usePreviewPlayer(), { wrapper });

    await act(async () => {
      await result.current.play({
        key: 'show:row-a',
        previewUrl: 'https://p/a.mp3',
        spotifyTrackId: null,
      });
    });
    assert.equal(result.current.currentTrackKey, 'show:row-a');

    await act(async () => {
      await result.current.play({
        key: 'show:row-a',
        previewUrl: 'https://p/a.mp3',
        spotifyTrackId: null,
      });
    });
    assert.equal(result.current.currentTrackKey, null);
    assert.equal(result.current.isPlaying, false);
  });

  it('clears currentTrackKey when the audio element ends naturally', async () => {
    const { result } = renderHook(() => usePreviewPlayer(), { wrapper });

    await act(async () => {
      await result.current.play({
        key: 'show:row-a',
        previewUrl: 'https://p/a.mp3',
        spotifyTrackId: null,
      });
    });
    assert.equal(result.current.currentTrackKey, 'show:row-a');

    act(() => {
      lastInstance?.emit('ended');
    });
    assert.equal(result.current.currentTrackKey, null);
    assert.equal(result.current.isPlaying, false);
  });

  it('fires onUnavailable when no preview and no driver', async () => {
    const { result } = renderHook(() => usePreviewPlayer(), { wrapper });

    let called = false;
    await act(async () => {
      await result.current.play(
        {
          key: 'show:row-a',
          previewUrl: null,
          spotifyTrackId: null,
        },
        () => {
          called = true;
        },
      );
    });
    assert.equal(called, true);
    assert.equal(result.current.currentTrackKey, null);
    assert.equal(audioCalls.length, 0);
  });

  it('prefers the FullTrackDriver when spotifyTrackId is present', async () => {
    const { result } = renderHook(() => usePreviewPlayer(), { wrapper });

    const driverCalls: string[] = [];
    const driver: FullTrackDriver = {
      async play(id) {
        driverCalls.push(id);
      },
      async stop() {
        // no-op
      },
    };
    act(() => {
      result.current.setFullTrackDriver(driver);
    });
    assert.equal(result.current.hasFullTrackDriver, true);

    await act(async () => {
      await result.current.play({
        key: 'show:row-a',
        previewUrl: 'https://p/a.mp3',
        spotifyTrackId: 'sp123',
      });
    });
    assert.deepEqual(driverCalls, ['sp123']);
    // We never touched the audio element when the driver succeeded.
    assert.equal(audioCalls.length, 0);
    assert.equal(result.current.currentTrackKey, 'show:row-a');
  });

  it('falls back to the preview when the FullTrackDriver throws', async () => {
    const { result } = renderHook(() => usePreviewPlayer(), { wrapper });

    act(() => {
      result.current.setFullTrackDriver({
        async play() {
          throw new Error('SDK borked');
        },
        async stop() {
          // no-op
        },
      });
    });

    await act(async () => {
      await result.current.play({
        key: 'show:row-a',
        previewUrl: 'https://p/a.mp3',
        spotifyTrackId: 'sp123',
      });
    });
    assert.equal(result.current.currentTrackKey, 'show:row-a');
    assert.equal(audioCalls.length, 1);
    assert.equal(audioCalls[0]?.src, 'https://p/a.mp3');
  });
});
