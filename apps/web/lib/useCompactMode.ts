import { trpc } from "@/lib/trpc";

/**
 * Returns the user's compact-mode preference. Resolves to `false` while
 * preferences are still loading so layouts default to roomier rows.
 *
 * The preference is also mirrored to `<html data-compact="true">` by
 * `<PrefsServerSync>` so global CSS rules can react to it without each
 * component subscribing.
 */
export function useCompactMode(): boolean {
  const { data } = trpc.preferences.get.useQuery(undefined, {
    staleTime: 30_000,
  });
  return data?.preferences?.compactMode ?? false;
}
