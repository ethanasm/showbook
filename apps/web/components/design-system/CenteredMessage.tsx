"use client";

interface CenteredMessageProps {
  children: React.ReactNode;
  tone?: "error";
}

export function CenteredMessage({ children, tone }: CenteredMessageProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 300,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: tone === "error" ? "var(--kind-theatre)" : "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}
