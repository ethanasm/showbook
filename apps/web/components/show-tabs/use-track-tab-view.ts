"use client";

import { useCallback, useRef } from "react";
import type { ShowTabKey } from "./types";

interface UseTrackTabViewOpts {
  showId: string;
  isPast: boolean;
}

/**
 * Emit `setlist_intel.show_tab.viewed` to `/api/telemetry/show-tab`
 * (best-effort, fire-and-forget) once per (tab, showId, isPast)
 * combination per mount. The endpoint logs the event via the shared
 * pino → Axiom pipeline so we can see which tab gets the most traffic
 * before optimizing.
 *
 * The de-dupe key is intentionally tab+show+isPast (not just tab) so
 * re-mounts after navigation count fresh, while a user clicking
 * Setlist → Media → Setlist within one mount only fires Setlist
 * once. Tabs viewed in a session contribute a single Axiom event each.
 */
export function useTrackTabView({ showId, isPast }: UseTrackTabViewOpts) {
  const fired = useRef<Set<string>>(new Set());
  return useCallback(
    (tab: ShowTabKey) => {
      const key = `${tab}|${showId}|${isPast ? 1 : 0}`;
      if (fired.current.has(key)) return;
      fired.current.add(key);
      void fetch("/api/telemetry/show-tab", {
        method: "POST",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tab, showId, isPast }),
      }).catch(() => {
        // Telemetry is best-effort; swallow network errors.
      });
    },
    [showId, isPast],
  );
}
