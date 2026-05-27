/**
 * Auth gate. Routes the user to the appropriate stack based on session state.
 *
 *   isLoading       → render nothing (avoid a flash to the wrong stack)
 *   offline + cache empty → render the offline screen so a cold-launch
 *                           with no signal doesn't strand the user on a
 *                           blank shell or a perpetually loading sign-in
 *   no user         → redirect to (auth)/signin
 *   user, first run → redirect to (auth)/first-run/welcome
 *   user, returning → redirect to (tabs)
 *
 * The offline gate is skipped in E2E mode (EXPO_PUBLIC_E2E_MODE=1).
 * The self-hosted Maestro emulator routes through the runner's host
 * network, which intermittently fails the NetInfo internet-reachable
 * probe — the test path is auth + navigation, not the offline UI, so
 * unconditionally falling through to the signin redirect keeps the
 * test reliable. The bypass is dead code in production builds (the
 * gate is set only by the `e2e` EAS profile in eas.json).
 */

import React from 'react';
import { Redirect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { useNetwork } from '@/lib/network';
import { isE2EMode } from '@/lib/auth-helpers';
import OfflineScreen from './_offline';

export default function Index(): React.JSX.Element | null {
  const { user, isLoading, isFirstRun } = useAuth();
  const { online } = useNetwork();
  const queryClient = useQueryClient();
  // `getAll()` returns 0 entries until the persister has hydrated. In the
  // worst case (offline cold launch, persister still loading) we'd render
  // the offline screen for a tick before redirecting; that's strictly
  // better than a blank route or a permanently-spinning sign-in form.
  const cacheEmpty = queryClient.getQueryCache().getAll().length === 0;

  if (!online && cacheEmpty && !isE2EMode()) {
    return <OfflineScreen />;
  }
  if (isLoading) return null;
  if (!user) return <Redirect href="/(auth)/signin" />;
  if (isFirstRun) return <Redirect href="/(auth)/first-run/welcome" />;
  return <Redirect href="/(tabs)" />;
}
