"use client";

// Canonical implementation lives in `@showbook/shared/hooks` and is
// shared with the mobile app. This shim re-exports it under the
// existing `@/lib/useDebouncedValue` specifier so Next.js sees a
// proper "use client" boundary for the hook in the web app's RSC
// graph.
export { useDebouncedValue } from "@showbook/shared/hooks";
