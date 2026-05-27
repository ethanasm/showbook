/**
 * QueryBoundary — render-prop wrapper around tRPC / react-query results.
 *
 * Centralises the loading → error → empty → success branching every
 * screen was hand-rolling. Each slot is optional; sensible defaults
 * (ActivityIndicator + EmptyState with retry) cover the simple case,
 * while richer screens can pass custom skeleton / error / empty UI
 * that wraps the same RefreshControl as the success path.
 */

import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { EmptyState } from './EmptyState';
import { useTheme } from '@/lib/theme';

type QueryLike<TData> = {
  isLoading: boolean;
  isError?: boolean;
  error?: { message?: string } | null | unknown;
  data: TData | undefined;
  refetch?: () => Promise<unknown> | unknown;
};

export interface QueryBoundaryProps<TData> {
  query: QueryLike<TData>;
  loading?: React.ReactNode;
  error?: (err: unknown, retry: () => void) => React.ReactNode;
  empty?: React.ReactNode;
  isEmpty?: (data: TData) => boolean;
  children: (data: TData) => React.ReactNode;
}

export function QueryBoundary<TData>({
  query,
  loading,
  error,
  empty,
  isEmpty,
  children,
}: QueryBoundaryProps<TData>): React.JSX.Element {
  const { tokens } = useTheme();

  // Initial load: nothing is in the cache yet.
  if (query.isLoading) {
    return (
      <>
        {loading ?? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={tokens.colors.muted} />
          </View>
        )}
      </>
    );
  }

  // Show the error UI ONLY when there's no cached data to fall back on.
  // A transient refetch failure on a screen that already has data should
  // keep the cached UI visible (matching the legacy `isError && !data`
  // guard the migrated screens used to write inline).
  if (query.data === undefined) {
    const retry = () => {
      if (query.refetch) void query.refetch();
    };
    if (error) return <>{error(query.error, retry)}</>;
    const message =
      typeof query.error === 'object' && query.error !== null && 'message' in query.error
        ? String((query.error as { message?: unknown }).message ?? '')
        : '';
    return (
      <EmptyState
        title="Couldn't load"
        subtitle={message || undefined}
        cta={query.refetch ? { label: 'Try again', onPress: retry } : undefined}
      />
    );
  }

  if (isEmpty && isEmpty(query.data) && empty !== undefined) {
    return <>{empty}</>;
  }

  return <>{children(query.data)}</>;
}
