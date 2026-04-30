"use client";

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
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "14px 0",
        borderBottom: last ? "none" : "1px solid var(--rule)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
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
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}
