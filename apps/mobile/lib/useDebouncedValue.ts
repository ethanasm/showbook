/**
 * Returns a value that updates `delay` ms after the input stops changing.
 * Mobile port of `apps/web/lib/useDebouncedValue.ts`.
 *
 * Used by venue typeahead in the Add/Edit forms (M3) and Search (M5).
 */

import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
