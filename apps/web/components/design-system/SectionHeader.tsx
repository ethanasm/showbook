"use client";

interface SectionHeaderProps {
  label: string;
  note?: string;
}

export function SectionHeader({ label, note }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 11.5,
          color: "var(--ink)",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {note && (
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 11.5,
            color: "var(--faint)",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}
