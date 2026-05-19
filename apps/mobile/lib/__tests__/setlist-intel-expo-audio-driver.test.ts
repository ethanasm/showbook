/**
 * Regression test for the cold-start crash where an installed dev
 * client without the `expo-audio` native module would die at boot
 * with `Cannot read property 'ErrorBoundary' of undefined`.
 *
 * The chain that triggered it: `app/(tabs)/_layout.tsx` eagerly
 * imports `app/show/[id].tsx` for the iPad three-pane layout, which
 * pulls in `ShowDetailTabsView` → `TrackPreviewButton` →
 * `expo-audio-driver.ts`. Originally that file did a top-level
 * `import { createAudioPlayer } from 'expo-audio'`, so the
 * `requireNativeModule('ExpoAudio')` inside expo-audio fired during
 * module evaluation. On a binary built before #254 added the dep, the
 * throw cascaded up the eager-import chain and expo-router's route
 * loader handed an undefined module to `fromImport`, which
 * destructured `{ ErrorBoundary, ...component }` and surfaced the
 * confusing error message at the root boundary.
 *
 * The fix defers the `expo-audio` require until first `play()`, so
 * importing the driver module never reaches the native bridge.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';

describe('expo-audio-driver module load', () => {
  it('importing the driver does not require expo-audio at module eval', () => {
    // Monkey-patch the loader to fail if `expo-audio` is required during
    // module evaluation — mirrors a binary where the native module isn't
    // registered.
    const originalResolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
    let loadedExpoAudio = false;
    (Module as unknown as { _resolveFilename: Function })._resolveFilename = function patched(
      request: string,
      parent: unknown,
      ...rest: unknown[]
    ) {
      if (request === 'expo-audio') {
        loadedExpoAudio = true;
        throw new Error("Cannot find native module 'ExpoAudio'");
      }
      return originalResolve.call(this, request, parent, ...rest);
    };

    try {
      // Require the driver fresh — if it imports `expo-audio` at the top
      // level the patched resolver throws, which would fail this test.
      const mod = require('../setlist-intel/expo-audio-driver');
      assert.ok(mod.ExpoAudioDriver, 'ExpoAudioDriver should still export');
      assert.equal(
        loadedExpoAudio,
        false,
        'expo-audio must not be required during module evaluation',
      );
    } finally {
      (Module as unknown as { _resolveFilename: Function })._resolveFilename = originalResolve;
    }
  });

  it('constructing the driver does not require expo-audio', () => {
    const originalResolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
    let loadedExpoAudio = false;
    (Module as unknown as { _resolveFilename: Function })._resolveFilename = function patched(
      request: string,
      parent: unknown,
      ...rest: unknown[]
    ) {
      if (request === 'expo-audio') {
        loadedExpoAudio = true;
        throw new Error("Cannot find native module 'ExpoAudio'");
      }
      return originalResolve.call(this, request, parent, ...rest);
    };

    try {
      const { ExpoAudioDriver, __resetExpoAudioCacheForTest } = require(
        '../setlist-intel/expo-audio-driver',
      );
      __resetExpoAudioCacheForTest();
      // Just instantiating the class — no playback — must not touch
      // the native bridge.
      new ExpoAudioDriver();
      assert.equal(loadedExpoAudio, false);
    } finally {
      (Module as unknown as { _resolveFilename: Function })._resolveFilename = originalResolve;
    }
  });

  it('play() no-ops gracefully when expo-audio is unavailable', async () => {
    const originalResolve = (Module as unknown as { _resolveFilename: Function })._resolveFilename;
    (Module as unknown as { _resolveFilename: Function })._resolveFilename = function patched(
      request: string,
      parent: unknown,
      ...rest: unknown[]
    ) {
      if (request === 'expo-audio') {
        throw new Error("Cannot find native module 'ExpoAudio'");
      }
      return originalResolve.call(this, request, parent, ...rest);
    };

    try {
      const { ExpoAudioDriver, __resetExpoAudioCacheForTest } = require(
        '../setlist-intel/expo-audio-driver',
      );
      __resetExpoAudioCacheForTest();
      const driver = new ExpoAudioDriver();
      // play() should swallow the missing-module case rather than throw —
      // the preview button stays inert but the app doesn't crash.
      await driver.play('https://example.com/clip.mp3');
      await driver.stop();
      await driver.dispose();
    } finally {
      (Module as unknown as { _resolveFilename: Function })._resolveFilename = originalResolve;
    }
  });
});
