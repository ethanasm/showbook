/**
 * Guards for the Google Maps key wiring — the failure mode this app actually
 * shipped (mobile-v0.2.0): the key lived in `android.config.googleMaps.apiKey`,
 * which Expo SDK 56 no longer reads (`@expo/prebuild-config` dropped the
 * handling), and the bare `'react-native-maps'` plugin entry — listed without
 * props — actively REMOVES the `com.google.android.geo.API_KEY` meta-data from
 * AndroidManifest.xml. The binary shipped with no key and the Google Maps SDK
 * hard-crashed the app whenever the Map tab's MapView initialised on Android.
 *
 * The only live path on SDK 56 is the react-native-maps plugin's
 * `androidGoogleMapsApiKey` prop, so this test pins:
 *  1. the plugin is configured as a [name, props] tuple (not a bare string),
 *  2. the env key is threaded into `androidGoogleMapsApiKey`,
 *  3. nothing reintroduces the dead `android.config.googleMaps` /
 *     `ios.config.googleMapsApiKey` fields, which would imply they work.
 *
 * The env var must be set BEFORE app.config.ts is evaluated (the key is read
 * at module scope), hence the lazy dynamic import below — a static import
 * would be hoisted above the env assignment. Each test file runs in its own
 * node:test process, so the env write can't leak into other tests' view of
 * the config.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpoConfig } from 'expo/config';

process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-maps-key';

const configPromise: Promise<ExpoConfig> = import('../../app.config.js').then(
  (m) => m.default,
);

type MapsPluginProps = { androidGoogleMapsApiKey?: string; iosGoogleMapsApiKey?: string };
type MapsPluginEntry = string | [string, MapsPluginProps];

async function findMapsPluginEntry(): Promise<MapsPluginEntry | undefined> {
  const appConfig = await configPromise;
  for (const plugin of appConfig.plugins ?? []) {
    if (plugin === 'react-native-maps') return plugin;
    if (Array.isArray(plugin) && plugin[0] === 'react-native-maps') {
      return plugin as [string, MapsPluginProps];
    }
  }
  return undefined;
}

describe('react-native-maps config', () => {
  it('is present in app.config.ts', async () => {
    assert.ok(await findMapsPluginEntry(), 'react-native-maps plugin should be configured');
  });

  it('is a [name, props] tuple — a bare string entry strips the Android API key from the manifest', async () => {
    assert.ok(
      Array.isArray(await findMapsPluginEntry()),
      'react-native-maps must be configured with props; the prop-less form removes com.google.android.geo.API_KEY at prebuild',
    );
  });

  it('threads EXPO_PUBLIC_GOOGLE_MAPS_API_KEY into androidGoogleMapsApiKey', async () => {
    const entry = await findMapsPluginEntry();
    const props = Array.isArray(entry) ? entry[1] : undefined;
    assert.equal(props?.androidGoogleMapsApiKey, 'test-maps-key');
  });

  it('does not pull the Google Maps iOS SDK into the build (Apple Maps is the iOS provider)', async () => {
    const entry = await findMapsPluginEntry();
    const props = Array.isArray(entry) ? entry[1] : undefined;
    assert.equal(props?.iosGoogleMapsApiKey, undefined);
  });

  it('does not reintroduce the dead SDK-56 config fields', async () => {
    const appConfig = await configPromise;
    assert.equal(
      (appConfig.android?.config as { googleMaps?: unknown } | undefined)?.googleMaps,
      undefined,
      'android.config.googleMaps is not read by Expo SDK 56 prebuild — use the plugin props',
    );
    assert.equal(
      (appConfig.ios?.config as { googleMapsApiKey?: string } | undefined)?.googleMapsApiKey,
      undefined,
      'ios.config.googleMapsApiKey is not read by Expo SDK 56 prebuild — and iOS uses Apple Maps',
    );
  });
});
