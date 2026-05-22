"use client";

import { Check, MapPin } from "lucide-react";

interface RegionChipProps {
  name: string;
  radius: number;
  active: boolean;
  onToggle: () => void;
  onRemove: () => void;
  disabled?: boolean;
}

export function RegionChip({
  name,
  radius,
  active,
  onToggle,
  onRemove,
  disabled,
}: RegionChipProps) {
  return (
    <div
      style={{
        padding: "10px 14px",
        border: active
          ? "1.5px solid var(--accent)"
          : "1px solid var(--rule-strong)",
        background: active ? "var(--accent-faded)" : "transparent",
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
      onClick={() => !disabled && onToggle()}
    >
      <MapPin
        size={14}
        color={active ? "var(--accent)" : "var(--faint)"}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-geist-sans)",
            fontSize: 13,
            fontWeight: active ? 600 : 500,
            color: "var(--ink)",
            letterSpacing: -0.1,
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: 10,
            color: "var(--faint)",
            marginTop: 2,
          }}
        >
          {radius}mi radius
        </div>
      </div>
      {active && <Check size={14} color="var(--accent)" />}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) onRemove();
        }}
        disabled={disabled}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          border: "none",
          background: "transparent",
          color: "var(--faint)",
          cursor: disabled ? "not-allowed" : "pointer",
          padding: 0,
        }}
        aria-label={`Remove ${name}`}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
