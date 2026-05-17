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
      isPlaying: false,
    });
  });

  it('plays a row when a preview URL is provided', async () => {
    const { driver, controller, states } = makeController();
    await controller.play({
      key: 'show-1:hot stuff',
      previewUrl: 'https://p.scdn.co/clip.mp3',
      spotifyTrackId: null,
    });
    assert.deepEqual(driver.playedUrls, ['https://p.scdn.co/clip.mp3']);
    assert.equal(controller.getState().currentTrackKey, 'show-1:hot stuff');
    assert.equal(controller.getState().isPlaying, true);
    assert.equal(states[states.length - 1]?.isPlaying, true);
  });

  it('fires onUnavailable when the URL is missing', async () => {
    const { driver, controller } = makeController();
    let fired = false;
    await controller.play(
      { key: 'row-no-preview', previewUrl: null, spotifyTrackId: null },
      () => {
        fired = true;
      },
    );
    assert.equal(fired, true);
    assert.equal(controller.getState().currentTrackKey, null);
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
    // First play stops once (idle cleanup); second play stops once again
    // before swapping the source.
    assert.ok(driver.stops >= 2);
    assert.equal(controller.getState().currentTrackKey, 'row-b');
  });

  it('handleEnded resets state when the clip ends naturally', async () => {
    const { controller } = makeController();
    await controller.play({
      key: 'row-c',
      previewUrl: 'https://p.scdn.co/c.mp3',
      spotifyTrackId: null,
    });
    controller.handleEnded();
    assert.deepEqual(controller.getState(), {
      currentTrackKey: null,
      isPlaying: false,
    });
  });

  it('dispose tears the driver down', async () => {
    const { driver, controller } = makeController();
    await controller.dispose();
    assert.equal(driver.disposed, true);
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
