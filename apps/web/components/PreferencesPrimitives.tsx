"use client";

import { useIsMobile } from "@/lib/useIsMobile";

interface SectionHeadProps {
  label: string;
  sub?: string;
}

export function SectionHead({ label, sub }: SectionHeadProps) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div
        style={{
          fontFamily: "var(--font-geist-mono)",
          fontSize: 11,
          color: "var(--ink)",
          letterSpacing: ".1em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono)",
            fontSize: 10.5,
            color: "var(--faint)",
            marginTop: 3,
            letterSpacing: ".04em",
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  last?: boolean;
  children: React.ReactNode;
}

export function SettingRow({
  label,
  description,
  last,
  children,
}: SettingRowProps) {
  // Mobile: stack the control below the label/description. The row was
  // overflowing right when the control was wider than the remaining
  // horizontal space (e.g. the 3-segment "STYLE DEFAULT / ALWAYS BLUR /
  // NEVER BLUR" picker on the Setlist-spoilers row crushed the label
  // column into a one-word-per-line stack and still spilled off-screen).
  const isMobile = useIsMobile();
  return (
    <div
      style={{
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        alignItems: isMobile ? "flex-start" : "center",
        justifyContent: "space-between",
        gap: isMobile ? 10 : 16,
        padding: "14px 0",
        borderBottom: last ? "none" : "1px solid var(--rule)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, width: isMobile ? "100%" : undefined }}>
        <div
          style={{
            fontFamily: "var(--font-geist-sans)",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            letterSpacing: -0.15,
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              color: "var(--muted)",
              marginTop: 3,
              letterSpacing: ".04em",
            }}
          >
            {description}
          </div>
        )}
      </div>
      <div
        style={{
          flexShrink: 0,
          // Let wide controls (e.g. the 3-segment picker) take the full
          // row width on mobile so the segments stay readable instead of
          // pushing the parent past the viewport edge.
          width: isMobile ? "100%" : undefined,
          // Keep wide segmented controls from extending past the row.
          maxWidth: "100%",
          overflowX: isMobile ? "auto" : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
}
