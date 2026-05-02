/**
 * Toast + Banner feedback system.
 *
 * Toast — top-anchored, 4s auto-dismiss, optional retry CTA. Use for
 * transient errors and non-blocking confirmations.
 *
 * Banner — top-anchored, persistent until dismissed. Use for offline state,
 * stale-data warnings, ongoing background work.
 *
 * Pure logic + provider lives here; visual primitives are in
 * `components/Toast.tsx` + `components/Banner.tsx`.
 *
 * Usage:
 *   const { showToast } = useFeedback();
 *   showToast({ kind: 'error', text: 'Sign-in failed', action: { label: 'Retry', onPress: ... } });
 */

import React from 'react';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastInput {
  kind?: ToastKind;
  text: string;
  // Optional inline action (e.g., 'Retry'). Auto-dismisses on press.
  action?: { label: string; onPress: () => void };
  // Override default 4000ms auto-dismiss. Pass 0 for sticky.
  durationMs?: number;
}

export interface Toast extends Required<Omit<ToastInput, 'action'>> {
  id: string;
  action: ToastInput['action'];
}

export interface BannerInput {
  kind?: ToastKind;
  text: string;
  action?: { label: string; onPress: () => void };
}

export interface Banner extends Required<Omit<BannerInput, 'action'>> {
  id: string;
  action: BannerInput['action'];
}

export interface FeedbackContextValue {
  toasts: Toast[];
  banners: Banner[];
  showToast: (input: ToastInput) => string; // returns id
  dismissToast: (id: string) => void;
  showBanner: (input: BannerInput) => string;
  dismissBanner: (id: string) => void;
  dismissAllBanners: () => void;
}

const FeedbackContext = React.createContext<FeedbackContextValue | null>(null);

const DEFAULT_TOAST_MS = 4000;

let nextId = 1;
function genId(): string {
  return `fb-${nextId++}`;
}

/** Reset id counter — for tests only. */
export function __resetFeedbackIdCounterForTest(): void {
  nextId = 1;
}

export function FeedbackProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [banners, setBanners] = React.useState<Banner[]>([]);

  const dismissToast = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = React.useCallback(
    (input: ToastInput): string => {
      const id = genId();
      const toast: Toast = {
        id,
        kind: input.kind ?? 'info',
        text: input.text,
        durationMs: input.durationMs ?? DEFAULT_TOAST_MS,
        action: input.action,
      };
      setToasts((prev) => [...prev, toast]);
      if (toast.durationMs > 0) {
        setTimeout(() => dismissToast(id), toast.durationMs);
      }
      return id;
    },
    [dismissToast],
  );

  const dismissBanner = React.useCallback((id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  const showBanner = React.useCallback((input: BannerInput): string => {
    const id = genId();
    const banner: Banner = {
      id,
      kind: input.kind ?? 'info',
      text: input.text,
      action: input.action,
    };
    setBanners((prev) => [...prev, banner]);
    return id;
  }, []);

  const dismissAllBanners = React.useCallback(() => {
    setBanners([]);
  }, []);

  const value = React.useMemo<FeedbackContextValue>(
    () => ({
      toasts,
      banners,
      showToast,
      dismissToast,
      showBanner,
      dismissBanner,
      dismissAllBanners,
    }),
    [
      toasts,
      banners,
      showToast,
      dismissToast,
      showBanner,
      dismissBanner,
      dismissAllBanners,
    ],
  );

  return React.createElement(FeedbackContext.Provider, { value }, children);
}

export function useFeedback(): FeedbackContextValue {
  const ctx = React.useContext(FeedbackContext);
  if (!ctx) {
    throw new Error('useFeedback must be used within a FeedbackProvider');
  }
  return ctx;
}
