type Variant = "default" | "table" | "hero";

const PULSE = "showbook-skeleton-pulse 1.2s ease-in-out infinite";
const SURFACE = "var(--surface2, #1c1c1c)";

function Bar({
  height,
  width,
  radius = 4,
}: {
  height: number;
  width: string | number;
  radius?: number;
}) {
  return (
    <div
      style={{
        height,
        width,
        background: SURFACE,
        borderRadius: radius,
        animation: PULSE,
      }}
    />
  );
}

export function PageSkeleton({ variant = "default" }: { variant?: Variant }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        padding: "32px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Bar height={28} width="30%" radius={6} />
      {variant === "hero" ? (
        <Bar height={140} width="100%" radius={12} />
      ) : null}
      <Bar height={16} width="60%" />
      <Bar height={16} width="45%" />
      {variant === "table" ? (
        <>
          <Bar height={44} width="100%" radius={6} />
          <Bar height={44} width="100%" radius={6} />
          <Bar height={44} width="100%" radius={6} />
          <Bar height={44} width="100%" radius={6} />
        </>
      ) : null}
      <style>{`
        @keyframes showbook-skeleton-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
