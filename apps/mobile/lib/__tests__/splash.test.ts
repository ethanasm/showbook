/**
 * Guards for the launch-splash config — the three failure modes this app has
 * actually shipped:
 *
 *  1. An image-less `expo-splash-screen` config breaks the *release Android
 *     build*: withAndroidSplashStyles unconditionally emits
 *     `windowSplashScreenAnimatedIcon -> @drawable/splashscreen_logo`, but the
 *     drawable is only generated when an image is set, so the build fails at
 *     `processReleaseResources` with "resource drawable/splashscreen_logo not
 *     found" (#533). CI's web/unit gate can't catch a native build break, so
 *     this test asserts the resolved Android image stays set and the file
 *     exists on disk.
 *
 *  2. A *visible* logo in the Android native splash brings back the cold-launch
 *     "small icon → normal icon" pop: the Android 12+ system splash renders the
 *     drawable circle-masked at a fixed OS icon size that no `imageWidth` can
 *     match to the 200dp JS <BrandSplash/>. #539 reintroduced exactly this by
 *     fixing failure (1) with the real splash.png instead of a blank one. So
 *     the Android override (light AND dark — the plugin merges `dark` per-key,
 *     so a missing `android.dark.image` silently inherits the root logo) must
 *     point at the fully transparent splash-blank.png.
 *
 *  3. The iOS native splash `imageWidth` and the JS <BrandSplash/> box drifting
 *     apart produces the same pop on iOS. app.config.ts can't import the shared
 *     SPLASH_IMAGE_WIDTH constant (the Expo config loader doesn't resolve
 *     transitive .ts imports), so this test pins the config literal to the
 *     constant BrandSplash uses.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPLASH_IMAGE_WIDTH } from '../splash.js';
import appConfig from '../../app.config.js';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

type SplashImageConfig = {
  image?: string;
  imageWidth?: number;
  backgroundColor?: string;
  dark?: { image?: string; imageWidth?: number; backgroundColor?: string };
};

type SplashPluginConfig = SplashImageConfig & {
  android?: SplashImageConfig;
  ios?: SplashImageConfig;
};

function findSplashPluginConfig(): SplashPluginConfig | undefined {
  for (const plugin of appConfig.plugins ?? []) {
    if (Array.isArray(plugin) && plugin[0] === 'expo-splash-screen') {
      return plugin[1] as SplashPluginConfig;
    }
  }
  return undefined;
}

/**
 * Mirrors the plugin's getAndroidSplashConfig merge:
 * `{...root, ...android, dark: {...root.dark, ...android.dark}}` — the
 * resolved values are what the build actually uses, so assert against these
 * rather than the raw override object.
 */
function resolveAndroid(splash: SplashPluginConfig): SplashImageConfig {
  const { android = {}, ios: _ios, ...root } = splash;
  return { ...root, ...android, dark: { ...root.dark, ...android.dark } };
}

describe('expo-splash-screen config', () => {
  const splash = findSplashPluginConfig();

  it('is present in app.config.ts', () => {
    assert.ok(splash, 'expo-splash-screen plugin should be configured');
  });

  it('keeps a resolved Android image set (light + dark) so the splash drawable is generated', () => {
    const android = resolveAndroid(splash!);
    assert.ok(
      android.image,
      'resolved android image must be set — an image-less config breaks the Android release build',
    );
    assert.ok(android.dark?.image, 'resolved android dark image must be set for the same reason');
  });

  it('Android image (light + dark) is the transparent blank, so there is no small-icon pop', () => {
    const android = resolveAndroid(splash!);
    assert.equal(
      android.image,
      './assets/splash-blank.png',
      'Android 12+ renders the splash drawable small + circle-masked; only a transparent image avoids the cold-launch size pop',
    );
    assert.equal(
      android.dark?.image,
      './assets/splash-blank.png',
      'the plugin merges dark per-key — without an explicit android.dark.image the root logo leaks back in dark mode',
    );
  });

  it('the blank asset exists and is a PNG', () => {
    const android = resolveAndroid(splash!);
    const file = path.resolve(MOBILE_ROOT, android.image!);
    assert.ok(fs.existsSync(file), `${android.image} must exist or the Android build fails`);
    const header = fs.readFileSync(file).subarray(0, 8);
    assert.deepEqual(
      [...header],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      'splash-blank.png must be a valid PNG',
    );
  });

  it('keeps the real logo on iOS (root image, no Android-style size cap there)', () => {
    assert.equal(splash?.image, './assets/splash.png');
    assert.equal(splash?.dark?.image, './assets/splash.png');
  });

  it('iOS native imageWidth matches the JS BrandSplash box, so there is no cold-launch size pop', () => {
    assert.equal(splash?.imageWidth, SPLASH_IMAGE_WIDTH);
    assert.equal(splash?.dark?.imageWidth, SPLASH_IMAGE_WIDTH);
  });
});
