/**
 * Boot-time uncaught-JS-error reporter for the mobile app.
 *
 * **Why this exists.** Play Console crash reports surface the React
 * Native bridge wrapper (`com.facebook.react.common.JavascriptException`
 * at `ExceptionsManagerModule.reportException`) but commonly do NOT
 * include the underlying JS message or stack — that data lives in JS
 * land and is lost by the time the native handler logs the bridge
 * frames. The `mobile.*` telemetry sink in `lib/telemetry.ts` would
 * normally catch this, but it round-trips through tRPC, which means
 * the logger is `null` until `TrpcProviders` mounts inside the React
 * tree. A boot-time uncaught throw therefore reports nothing useful
 * anywhere we can read it.
 *
 * **What this does.** Installs `global.ErrorUtils.setGlobalHandler`
 * (React Native's bridge-level uncaught handler) and an
 * `unhandledRejection` listener on `global`, captures each, and POSTs
 * to the public `/api/mobile/crash-report` endpoint via raw `fetch()`
 * — no tRPC, no auth, no provider chain. Works even if it fires from a
 * top-level module evaluation, before any React component mounts.
 *
 * **Importing it early.** This module has a side effect: importing it
 * for the first time calls `installCrashReporter()` immediately. The
 * intent is for `app/_layout.tsx` to side-effect-import it at the very
 * top of the file so the handlers are in place before any other code
 * runs. `installCrashReporter()` is idempotent — calling it twice is
 * a no-op (the second call short-circuits on the install guard).
 *
 * **Pure logic lives in `crash-reporter-core.ts`** so it can be unit
 * tested without dragging in `react-native` (whose Flow-typed
 * `index.js` doesn't go through the test runner's `tsx` transformer).
 * This thin wrapper just injects `Platform.OS` + `Constants.expoConfig`
 * version/build into the env bag.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { API_URL } from './env';
import {
  installCrashReporterAgainst,
  reportCrash as reportCrashCore,
  type CrashEnv,
  type CrashPayload,
} from './crash-reporter-core';

const installedRef: { current: boolean } = { current: false };

function safePlatform(): 'ios' | 'android' | 'web' {
  if (Platform.OS === 'ios') return 'ios';
  if (Platform.OS === 'android') return 'android';
  return 'web';
}

function currentEnv(): CrashEnv {
  return {
    apiUrl: API_URL,
    platform: safePlatform(),
    version: Constants.expoConfig?.version,
    buildNumber:
      (Platform.OS === 'ios'
        ? Constants.expoConfig?.ios?.buildNumber
        : Constants.expoConfig?.android?.versionCode?.toString()) ?? undefined,
  };
}

export function reportCrash(payload: CrashPayload): void {
  reportCrashCore(payload, currentEnv());
}

export function installCrashReporter(): void {
  installCrashReporterAgainst(globalThis, currentEnv(), installedRef);
}

/** Test-only — reset module state between cases. */
export function __resetCrashReporterForTests(): void {
  installedRef.current = false;
}

// Install on first import. The side effect is the whole point — see
// the header comment. If you need to import this for the types alone,
// the `installedRef` guard makes it cheap.
installCrashReporter();
