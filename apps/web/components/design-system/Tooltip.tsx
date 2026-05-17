"use client";

import { useState, useRef, useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom";

interface TooltipPosition {
  x: number;
  y: number;
  placement: Placement;
}

const SHOW_DELAY_MS = 120;
const VIEWPORT_MARGIN = 6;
const TRIGGER_GAP = 6;

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: string;
  children: ReactNode;
  side?: Placement;
}) {
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const computePosition = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = tooltipRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const tipRect = tip?.getBoundingClientRect();
    const tipWidth = tipRect?.width ?? 0;
    const tipHeight = tipRect?.height ?? 0;

    let placement: Placement = side;
    if (placement === "top" && rect.top - tipHeight - TRIGGER_GAP < VIEWPORT_MARGIN) {
      placement = "bottom";
    } else if (
      placement === "bottom" &&
      rect.bottom + tipHeight + TRIGGER_GAP > window.innerHeight - VIEWPORT_MARGIN
    ) {
      placement = "top";
    }

    const triggerCenterX = rect.left + rect.width / 2;
    let x = triggerCenterX - tipWidth / 2;
    x = Math.max(VIEWPORT_MARGIN, Math.min(x, window.innerWidth - tipWidth - VIEWPORT_MARGIN));

    const y =
      placement === "top"
        ? rect.top - tipHeight - TRIGGER_GAP
        : rect.bottom + TRIGGER_GAP;

    setPosition({ x, y, placement });
  }, [side]);

  const open = useCallback(() => {
    if (showTimer.current !== null) return;
    showTimer.current = window.setTimeout(() => {
      showTimer.current = null;
      computePosition();
    }, SHOW_DELAY_MS);
  }, [computePosition]);

  const close = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setPosition(null);
  }, []);

  useEffect(() => {
    if (!position) return;
    const handler = () => computePosition();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
      window.removeEventListener("keydown", onKey);
    };
  }, [position, computePosition, close]);

  useEffect(() => {
    return () => {
      if (showTimer.current !== null) {
        window.clearTimeout(showTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (position && tooltipRef.current) {
      computePosition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position?.placement]);

  return (
    <>
      <span
        ref={triggerRef}
        aria-label={label}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        {children}
      </span>
      {mounted && position
        ? createPortal(
            <div
              ref={tooltipRef}
              role="tooltip"
              style={{
                position: "fixed",
                top: position.y,
                left: position.x,
                background: "var(--surface2)",
                border: "1px solid var(--rule-strong)",
                color: "var(--ink)",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                letterSpacing: ".04em",
                padding: "4px 8px",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                zIndex: 50,
              }}
            >
              {label}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
