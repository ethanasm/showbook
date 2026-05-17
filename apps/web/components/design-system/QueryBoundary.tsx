"use client";

import type { ReactNode } from "react";
import { CenteredMessage } from "./CenteredMessage";

type QueryLike<TData> = {
  isLoading: boolean;
  error?: unknown;
  data: TData | undefined;
};

interface QueryBoundaryProps<TData> {
  query: QueryLike<TData>;
  loadingLabel?: ReactNode;
  errorLabel?: ReactNode;
  loadingFallback?: ReactNode;
  errorFallback?: (error: unknown) => ReactNode;
  emptyFallback?: ReactNode;
  isEmpty?: (data: TData) => boolean;
  children: (data: TData) => ReactNode;
}

export function QueryBoundary<TData>({
  query,
  loadingLabel = "Loading…",
  errorLabel = "Couldn't load.",
  loadingFallback,
  errorFallback,
  emptyFallback,
  isEmpty,
  children,
}: QueryBoundaryProps<TData>) {
  if (query.isLoading) {
    return <>{loadingFallback ?? <CenteredMessage>{loadingLabel}</CenteredMessage>}</>;
  }

  if (query.error || query.data === undefined) {
    if (errorFallback) return <>{errorFallback(query.error)}</>;
    return <CenteredMessage tone="error">{errorLabel}</CenteredMessage>;
  }

  if (isEmpty && isEmpty(query.data) && emptyFallback !== undefined) {
    return <>{emptyFallback}</>;
  }

  return <>{children(query.data)}</>;
}
