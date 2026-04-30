"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const TRICKLE_INTERVAL_MS = 200;
const COMPLETE_DURATION_MS = 220;

export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number | null>(null);

  function clearTrickle() {
    if (trickleRef.current) {
      clearInterval(trickleRef.current);
      trickleRef.current = null;
    }
  }

  // Our patched history.pushState can be invoked synchronously from inside
  // React internals (useInsertionEffect, where setState is forbidden). Defer
  // state updates with queueMicrotask so they always land outside that frame.
  function start() {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
    clearTrickle();
    startedAtRef.current = Date.now();
    queueMicrotask(() => {
      setVisible(true);
      setProgress(8);
      requestAnimationFrame(() => setProgress(30));
    });
    trickleRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 90) return p;
        const remaining = 90 - p;
        return p + Math.max(0.5, remaining * 0.08);
      });
    }, TRICKLE_INTERVAL_MS);
  }

  function done() {
    if (!startedAtRef.current) return;
    clearTrickle();
    queueMicrotask(() => setProgress(100));
    hideTimeoutRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
      startedAtRef.current = null;
    }, COMPLETE_DURATION_MS);
  }

  // Stop on navigation completion (pathname / search change)
  useEffect(() => {
    if (startedAtRef.current) done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // Intercept anchor clicks + patch history methods so router.push triggers us
  useEffect(() => {
    function isModifiedClick(e: MouseEvent) {
      return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0;
    }

    function handleClick(e: MouseEvent) {
      if (isModifiedClick(e)) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (anchor.target && anchor.target !== "" && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;
      if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return;
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
      } catch {
        return;
      }
      start();
    }

    document.addEventListener("click", handleClick, true);

    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    window.history.pushState = function (...args) {
      const [, , url] = args;
      if (url) {
        try {
          const next = new URL(url.toString(), window.location.href);
          if (
            next.pathname !== window.location.pathname ||
            next.search !== window.location.search
          ) {
            start();
          }
        } catch {
          /* noop */
        }
      }
      return originalPush.apply(this, args);
    };
    window.history.replaceState = function (...args) {
      return originalReplace.apply(this, args);
    };

    return () => {
      document.removeEventListener("click", handleClick, true);
      window.history.pushState = originalPush;
      window.history.replaceState = originalReplace;
      clearTrickle();
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background: "var(--accent, #FFD166)",
          boxShadow: "0 0 8px var(--accent, #FFD166), 0 0 4px var(--accent, #FFD166)",
          transition: "width 200ms ease-out",
        }}
      />
    </div>
  );
}
