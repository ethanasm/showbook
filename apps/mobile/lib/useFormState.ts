/**
 * Minimal generic form-state hook. Three of the largest form screens
 * (add/form, show/[id]/edit, show/[id]/setlist) were each redefining
 * the same useCallback setter:
 *
 *   const set = useCallback(<K extends keyof T>(k: K, v: T[K]) =>
 *     setValues((p) => ({ ...p, [k]: v })), []);
 *
 * `useFormState` returns the `values` / `set` / `reset` triple so
 * screens stop owning that boilerplate. No validation, no schema —
 * those are caller-level concerns (form complexity in showbook is
 * low enough that adding react-hook-form/Zod would be overkill).
 */

import { useCallback, useState } from 'react';

export interface FormState<T> {
  values: T;
  /** Imperative per-field setter — `set('name', 'Hadestown')`. */
  set: <K extends keyof T>(key: K, next: T[K]) => void;
  /** Replace the entire form state (useful for "load from server" hydration). */
  reset: (next: T) => void;
  /** Functional merge — for callers that want to patch multiple fields atomically. */
  patch: (partial: Partial<T>) => void;
}

export function useFormState<T extends object>(initial: T): FormState<T> {
  const [values, setValues] = useState<T>(initial);

  const set = useCallback(
    <K extends keyof T>(key: K, next: T[K]) =>
      setValues((prev) => ({ ...prev, [key]: next })),
    [],
  );

  const reset = useCallback((next: T) => setValues(next), []);

  const patch = useCallback(
    (partial: Partial<T>) => setValues((prev) => ({ ...prev, ...partial })),
    [],
  );

  return { values, set, reset, patch };
}
