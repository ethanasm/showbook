/**
 * Auth gate. Routes the user to the appropriate stack based on session state.
 *
 *   isLoading       → render nothing (avoid a flash to the wrong stack)
 *   no user         → redirect to (auth)/signin
 *   user, first run → redirect to (auth)/first-run/welcome
 *   user, returning → redirect to (tabs) (Task 6)
 */

import { Redirect } from 'expo-router';
import { useAuth } from '../lib/auth';

export default function Index() {
  const { user, isLoading, isFirstRun } = useAuth();
  if (isLoading) return null;
  if (!user) return <Redirect href="/(auth)/signin" />;
  if (isFirstRun) return <Redirect href="/(auth)/first-run/welcome" />;
  return <Redirect href="/(tabs)" />;
}
