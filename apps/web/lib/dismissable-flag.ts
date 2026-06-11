"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * One-time dismissable UI flag persisted in localStorage. Used for the
 * Get Started checklist and the contextual first-run hints (ticket
 * status, etc.) so each surface shows its nudge once and stays quiet
 * after the user waves it off.
 *
 * SSR-safe: starts as not-dismissed and reads storage in an effect so
 * the server render and first client render agree.
 */
export function useDismissableFlag(storageKey: string) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      setDismissed(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // localStorage unavailable (private mode, SSR) — treat as not dismissed.
    }
  }, [storageKey]);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(storageKey, "1");
    } catch {
      // ignore — UI still flips via state below
    }
    setDismissed(true);
  }, [storageKey]);

  return { dismissed, dismiss };
}
