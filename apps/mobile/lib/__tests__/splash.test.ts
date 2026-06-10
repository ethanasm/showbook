/**
 * Guards for the launch-splash config — the two failure modes this app has
 * actually shipped:
 *
 *  1. An image-less `expo-splash-screen` config breaks the *release Android
 *     build*: withAndroidSplashStyles unconditionally emits
 *     `windowSplashScreenAnimatedIcon -> @drawable/splashscreen_logo`, but the
 *     drawable is only generated when `image` is set, so the build fails at
 *     `processReleaseResources` with "resource drawable/splashscreen_logo not
 *     found". CI's web/unit gate can't catch a native build break, so this
 *     test asserts the image stays set.
 *
 *  2. The native splash `imageWidth` and the JS <BrandSplash/> box drifting
 *     apart produces the "tiny native icon → normal JS icon" cold-launch pop.
 *     app.config.ts can't import the shared SPLASH_IMAGE_WIDTH constant (the
 *     Expo config loader doesn't resolve transitive .ts imports), so this test
 *     pins the config literal to the constant BrandSplash uses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SPLASH_IMAGE_WIDTH } from '../splash.js';
import appConfig from '../../app.config.js';

type SplashPluginConfig = {
  image?: string;
  imageWidth?: number;
  backgroundColor?: string;
  dark?: { image?: string; imageWidth?: number; backgroundColor?: string };
};

function findSplashPluginConfig(): SplashPluginConfig | undefined {
  for (const plugin of appConfig.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') {
      return plugin[1] as SplashPluginConfig;
    }
  }
  return undefined;
}

describe('expo-splash-screen config', () => {
  const splash = findSplashPluginConfig();

  it('is present in app.config.ts', () => {
    assert.ok(splash, 'expo-splash-screen plugin should be configured');
  });

  it('keeps an image set (light + dark) so the Android splash drawable is generated', () => {
    assert.ok(splash?.image, 'splash.image must be set — an image-less config breaks the Android release build');
    assert.ok(splash?.dark?.image, 'splash.dark.image must be set for the same reason');
  });

  it('native imageWidth matches the JS BrandSplash box, so there is no cold-launch size pop', () => {
    assert.equal(splash?.imageWidth, SPLASH_IMAGE_WIDTH);
    assert.equal(splash?.dark?.imageWidth, SPLASH_IMAGE_WIDTH);
  });
});
