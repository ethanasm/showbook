/**
 * useThemedRefreshControl — builds the app's themed `RefreshControl`
 * (haptic-gated spinner + failure feedback) for a list or ScrollView's
 * `refreshControl` prop.
 *
 * Haptic gating (selection on pull-start, success/warning on completion)
 * lives in `lib/useRefreshHaptics.ts` so it stays unit-tested; failure
 * classification lives in `lib/refresh-failure.ts`.
 */

import React from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '@/lib/theme';
import { signOutAndRedirect, useAuth } from '@/lib/auth';
import { useFeedback } from '@/lib/feedback';
import {
  classifyRefreshFailure,
  refreshFailureMessage,
} from '@/lib/refresh-failure';
import { useRefreshHaptics } from '@/lib/useRefreshHaptics';

/**
 * Build a themed RefreshControl element for use with FlatList / SectionList /
 * ScrollView's `refreshControl` prop.
 *
 * The `refreshing` argument is the underlying fetch state (typically
 * `query.isFetching && !query.isLoading`), but the spinner is only shown
 * when the current cycle was started by a real user pull. Without that
 * gate the iOS RefreshControl flashes on every background refetch and,
 * worse, can get stuck visible after a tab switch — the foreground-sync
 * hop invalidates all active queries on every app resume, and rapid
 * `refreshing` toggles leave the native spinner spinning. See the
 * `useRefreshHaptics` docblock for the manual-cycle bookkeeping.
 *
 * `onRefresh` should RETURN its `refetch()` promise (or a `Promise.all`
 * of several) rather than `void`ing it: the resolution is inspected so a
 * failed manual refresh surfaces as an error toast — "session expired",
 * "can't reach Showbook", or a generic failure — instead of silently
 * leaving stale data on screen (the offline-first cache means the screen
 * looks identical either way, which is exactly why the user has to be
 * told).
 */
export function useThemedRefreshControl(
  refreshing: boolean,
  onRefresh: () => void | PromiseLike<unknown>,
): React.ReactElement<RefreshControlProps> {
  const { tokens } = useTheme();
  const { showToast } = useFeedback();
  const { signOut } = useAuth();
  const router = useRouter();
  const onRefreshFailure = React.useCallback(
    (err: unknown) => {
      const kind = classifyRefreshFailure(err);
      showToast({
        kind: 'error',
        text: refreshFailureMessage(kind),
        action:
          kind === 'session-expired'
            ? {
                label: 'Sign in',
                onPress: () => {
                  void signOutAndRedirect(signOut, router);
                },
              }
            : undefined,
      });
    },
    [showToast, signOut, router],
  );
  const { onManualRefresh, manualRefreshing } = useRefreshHaptics(
    refreshing,
    onRefresh,
    undefined,
    onRefreshFailure,
  );
  return (
    <RefreshControl
      refreshing={manualRefreshing && refreshing}
      onRefresh={onManualRefresh}
      tintColor={tokens.colors.accent}
      colors={[tokens.colors.accent]}
      progressBackgroundColor={tokens.colors.surface}
    />
  );
}
