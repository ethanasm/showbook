"use client";

import { useEffect, useState } from "react";

/**
 * Returns a value that updates `delay` ms after the input stops changing.
 * Replaces the half-dozen ad-hoc useRef + setTimeout debouncers that lived
 * inline across discover, preferences, GlobalSearch, and the search modals.
 */
export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
