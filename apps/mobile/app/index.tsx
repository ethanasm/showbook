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
 */

import React from 'react';
import { Redirect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useNetwork } from '../lib/network';
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

  if (!online && cacheEmpty) {
    return <OfflineScreen />;
  }
  if (isLoading) return null;
  if (!user) return <Redirect href="/(auth)/signin" />;
  if (isFirstRun) return <Redirect href="/(auth)/first-run/welcome" />;
  return <Redirect href="/(tabs)" />;
}
