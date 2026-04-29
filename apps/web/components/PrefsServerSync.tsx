"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/components/design-system/ThemeProvider";
import { trpc } from "@/lib/trpc";

// Hydrates client UI state from server-side user preferences:
//  - Theme: synced once on first arrival of prefs so a fresh device picks up
//    the user's saved theme instead of the local default.
//  - Compact mode: mirrored continuously to a `data-compact` attribute on
//    <html> so any component can opt in via `[data-compact="true"]` CSS.
export function PrefsServerSync() {
  const { theme, setTheme } = useTheme();
  const themeSynced = useRef(false);
  const { data } = trpc.preferences.get.useQuery();

  useEffect(() => {
    if (themeSynced.current) return;
    const serverTheme = data?.preferences?.theme;
    if (!serverTheme) return;
    themeSynced.current = true;
    if (serverTheme !== theme) setTheme(serverTheme);
  }, [data, theme, setTheme]);

  useEffect(() => {
    const compact = data?.preferences?.compactMode ?? false;
    document.documentElement.setAttribute("data-compact", compact ? "true" : "false");
  }, [data]);

  return null;
}
