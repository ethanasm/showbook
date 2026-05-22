import { useEffect, useState } from 'react';

/**
 * Returns a value that updates `delay` ms after the input stops changing.
 * Replaces the half-dozen ad-hoc useRef + setTimeout debouncers that lived
 * inline across discover, preferences, GlobalSearch, search modals (web),
 * and the venue / artist typeaheads + global search (mobile).
 *
 * No `'use client'` directive — this module is consumed by both Next.js
 * client components (which already opt-in at their own file boundary)
 * and React Native, where the directive is meaningless.
 */
export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
