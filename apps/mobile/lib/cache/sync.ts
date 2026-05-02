/**
 * Pure foreground-sync trigger. The React Native `AppState` listener
 * lives in `useForegroundSync.ts` so this file stays importable in
 * Node (tests, scripts) without pulling in the RN runtime.
 */

import type { QueryClient } from '@tanstack/react-query';

export function triggerForegroundSync(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ type: 'active' });
}
