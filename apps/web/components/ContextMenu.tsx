"use client";

import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  position: { x: number; y: number };
  onClose: () => void;
}

export function ContextMenu({ items, position, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleMouseDown);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, [onClose]);

  // Clamp to viewport edges
  const MENU_WIDTH = 192;
  const APPROX_ITEM_H = 36;
  const visibleItems = items.filter((it) => !it.separator);
  const approxH = visibleItems.length * APPROX_ITEM_H + items.filter((it) => it.separator).length * 9;

  const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;

  const left = Math.min(position.x, vw - MENU_WIDTH - 8);
  const top = Math.min(position.y, vh - approxH - 8);

  return (
    <div
      ref={ref}
      data-testid="context-menu"
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 9999,
        background: "var(--surface)",
        border: "1px solid var(--rule-strong)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        minWidth: MENU_WIDTH,
        padding: "4px 0",
      }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return (
            <div
              key={i}
              style={{ height: 1, background: "var(--rule)", margin: "4px 0" }}
            />
          );
        }
        return (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 14px",
              border: "none",
              background: "transparent",
              cursor: item.disabled ? "not-allowed" : "pointer",
              color: item.danger
                ? "var(--kind-theatre)"
                : item.disabled
                  ? "var(--faint)"
                  : "var(--ink)",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: -0.1,
              textAlign: "left",
              opacity: item.disabled ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (!item.disabled) {
                (e.currentTarget as HTMLButtonElement).style.background =
                  "rgba(0,0,0,0.05)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background =
                "transparent";
            }}
          >
            {item.icon && (
              <span style={{ display: "inline-flex", flexShrink: 0 }}>
                {item.icon}
              </span>
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
