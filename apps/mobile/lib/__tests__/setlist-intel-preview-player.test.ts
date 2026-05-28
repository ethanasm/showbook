import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  NoopPlaybackDriver,
  PreviewPlayerController,
  type PreviewPlayerState,
} from '../setlist-intel/preview-player';

function makeController() {
  const driver = new NoopPlaybackDriver();
  const states: PreviewPlayerState[] = [];
  const controller = new PreviewPlayerController({
    driver,
    onStateChange: (s) => states.push({ ...s }),
  });
  return { driver, controller, states };
}

describe('PreviewPlayerController', () => {
  it('starts idle', () => {
    const { controller } = makeController();
    assert.deepEqual(controller.getState(), {
      currentTrackKey: null,
      loadingKey: null,
      isPlaying: false,
      currentLabel: null,
    });
  });

  it('plays a row when a preview URL is provided', async () => {
    const { driver, controller, states } = makeController();
    await controller.play({
      key: 'show-1:hot stuff',
      label: 'Hot Stuff',
      previewUrl: 'https://p.scdn.co/clip.mp3',
      spotifyTrackId: null,
    });
    assert.deepEqual(driver.playedUrls, ['https://p.scdn.co/clip.mp3']);
    assert.equal(controller.getState().currentTrackKey, 'show-1:hot stuff');
    assert.equal(controller.getState().isPlaying, true);
    assert.equal(controller.getState().currentLabel, 'Hot Stuff');
    assert.equal(states[states.length - 1]?.isPlaying, true);
  });

  it('fires onUnavailable when the URL is missing and no resolver is provided', async () => {
    const { driver, controller } = makeController();
    let fired = false;
    await controller.play(
      { key: 'row-no-preview', previewUrl: null, spotifyTrackId: null },
      {
        onUnavailable: () => {
          fired = true;
        },
      },
    );
    assert.equal(fired, true);
    assert.equal(controller.getState().currentTrackKey, null);
    assert.equal(controller.getState().loadingKey, null);
    // Driver.stop is still invoked once at the top of play for cleanup.
    assert.equal(driver.stops, 1);
    assert.deepEqual(driver.playedUrls, []);
  });

  it('toggles when the same row is tapped again', async () => {
    const { driver, controller } = makeController();
    await controller.play({
      key: 'show-1:foo',
      previewUrl: 'https://p.scdn.co/a.mp3',
      spotifyTrackId: null,
    });
    assert.equal(controller.getState().currentTrackKey, 'show-1:foo');
    await controller.play({
      key: 'show-1:foo',
      previewUrl: 'https://p.scdn.co/a.mp3',
      spotifyTrackId: null,
    });
    assert.equal(controller.getState().currentTrackKey, null);
    assert.equal(controller.getState().isPlaying, false);
    assert.equal(controller.getState().currentLabel, null);
    // Stop fires twice: once at the start of the toggle-stop branch,
    // plus the original play's initial cleanup.
    assert.ok(driver.stops >= 2);
  });

  it('stops the previous row when a new one starts (single-stream)', async () => {
    const { driver, controller } = makeController();
    await controller.play({
      key: 'row-a',
      previewUrl: 'https://p.scdn.co/a.mp3',
      spotifyTrackId: null,
    });
    await controller.play({
      key: 'row-b',
      previewUrl: 'https://p.scdn.co/b.mp3',
      spotifyTrackId: null,
    });
    assert.deepEqual(driver.playedUrls, [
      'https://p.scdn.co/a.mp3',
      'https://p.scdn.co/b.mp3',
    ]);
    assert.ok(driver.stops >= 2);
    assert.equal(controller.getState().currentTrackKey, 'row-b');
  });

  it('handleEnded resets state when the clip ends naturally', async () => {
    const { controller } = makeController();
    await controller.play({
      key: 'row-c',
      label: 'Track C',
      previewUrl: 'https://p.scdn.co/c.mp3',
      spotifyTrackId: null,
    });
    controller.handleEnded();
    assert.deepEqual(controller.getState(), {
      currentTrackKey: null,
      loadingKey: null,
      isPlaying: false,
      currentLabel: null,
    });
  });

  it('dispose tears the driver down', async () => {
    const { driver, controller } = makeController();
    await controller.dispose();
    assert.equal(driver.disposed, true);
  });

  it('invokes resolver when previewUrl is null, then plays the resolved URL', async () => {
    const { driver, controller, states } = makeController();
    let resolverCalled = 0;
    await controller.play(
      { key: 'row-lazy', label: 'Lazy', previewUrl: null, spotifyTrackId: null },
      {
        resolve: async () => {
          resolverCalled += 1;
          return {
            previewUrl: 'https://p.scdn.co/resolved.mp3',
            spotifyTrackId: 'spotify-123',
          };
        },
      },
    );
    assert.equal(resolverCalled, 1);
    assert.deepEqual(driver.playedUrls, ['https://p.scdn.co/resolved.mp3']);
    assert.equal(controller.getState().currentTrackKey, 'row-lazy');
    assert.equal(controller.getState().isPlaying, true);
    assert.equal(controller.getState().loadingKey, null);

    // Mid-flight there should be a loadingKey state.
    const loadingState = states.find((s) => s.loadingKey === 'row-lazy');
    assert.ok(loadingState, 'expected a loading state emission');
    assert.equal(loadingState.isPlaying, false);
  });

  it('marks unavailable when resolver returns no preview URL', async () => {
    const { driver, controller } = makeController();
    let unavailable = 0;
    await controller.play(
      { key: 'row-empty', previewUrl: null, spotifyTrackId: null },
      {
        resolve: async () => ({ previewUrl: null, spotifyTrackId: null }),
        onUnavailable: () => {
          unavailable += 1;
        },
      },
    );
    assert.equal(unavailable, 1);
    assert.equal(driver.playedUrls.length, 0);
    assert.equal(controller.getState().currentTrackKey, null);
    assert.equal(controller.getState().loadingKey, null);
  });

  it('marks unavailable when the resolver throws', async () => {
    const { driver, controller } = makeController();
    let unavailable = 0;
    await controller.play(
      { key: 'row-throws', previewUrl: null, spotifyTrackId: null },
      {
        resolve: async () => {
          throw new Error('boom');
        },
        onUnavailable: () => {
          unavailable += 1;
        },
      },
    );
    assert.equal(unavailable, 1);
    assert.equal(driver.playedUrls.length, 0);
    assert.equal(controller.getState().loadingKey, null);
  });

  it('skips the resolver when a cached previewUrl is present', async () => {
    const { driver, controller } = makeController();
    let resolverCalled = 0;
    await controller.play(
      {
        key: 'row-cached',
        previewUrl: 'https://p.scdn.co/cached.mp3',
        spotifyTrackId: null,
      },
      {
        resolve: async () => {
          resolverCalled += 1;
          return { previewUrl: 'should-not-use', spotifyTrackId: null };
        },
      },
    );
    assert.equal(resolverCalled, 0);
    assert.deepEqual(driver.playedUrls, ['https://p.scdn.co/cached.mp3']);
  });
});

describe('NoopPlaybackDriver', () => {
  it('records play attempts and stops', async () => {
    const driver = new NoopPlaybackDriver();
    await driver.play('https://a');
    await driver.play('https://b');
    await driver.stop();
    assert.deepEqual(driver.playedUrls, ['https://a', 'https://b']);
    assert.equal(driver.stops, 1);
  });
});

describe('PreviewPlayerController full-track driver branch', () => {
  it('hasFullTrackDriver flips when one is set or cleared', () => {
    const { controller } = makeController();
    assert.equal(controller.hasFullTrackDriver(), false);
    controller.setFullTrackDriver({
      play: async () => undefined,
      stop: async () => undefined,
    });
    assert.equal(controller.hasFullTrackDriver(), true);
    controller.setFullTrackDriver(null);
    assert.equal(controller.hasFullTrackDriver(), false);
  });

  it('playFullTrack rejects when no driver is mounted', async () => {
    const { controller } = makeController();
    await assert.rejects(
      () => controller.playFullTrack('2QsoVMTKj5m5kgztTOep98'),
      /no full-track driver/,
    );
  });

  it('playFullTrack hands the id to the driver and stops the preview driver first', async () => {
    const { driver, controller } = makeController();
    // Pre-play a preview so we can prove `playFullTrack` stops it.
    await controller.play({
      key: 'row-1',
      previewUrl: 'https://preview.mp3',
      spotifyTrackId: null,
    });
    assert.equal(driver.stops, 1, 'one stop from internal play()');
    const calls: string[] = [];
    controller.setFullTrackDriver({
      play: async (trackId) => {
        calls.push(trackId);
      },
      stop: async () => undefined,
    });
    await controller.playFullTrack('2QsoVMTKj5m5kgztTOep98');
    assert.deepEqual(calls, ['2QsoVMTKj5m5kgztTOep98']);
    // SDK playback runs in Spotify, not in-app — controller state
    // stays idle so the mini-player doesn't fight the SDK for the
    // active row.
    assert.equal(controller.getState().currentTrackKey, null);
    assert.equal(driver.stops, 2, 'preview driver stopped before SDK play');
  });

  it('playFullTrack propagates driver rejections so the caller can fall through', async () => {
    const { controller } = makeController();
    controller.setFullTrackDriver({
      play: async () => {
        throw new Error('SDK not connected');
      },
      stop: async () => undefined,
    });
    await assert.rejects(
      () => controller.playFullTrack('2QsoVMTKj5m5kgztTOep98'),
      /SDK not connected/,
    );
  });
});
