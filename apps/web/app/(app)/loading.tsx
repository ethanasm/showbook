export default function Loading() {
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
      <div
        style={{
          height: 28,
          width: "30%",
          background: "var(--surface2, #1c1c1c)",
          borderRadius: 6,
          animation: "showbook-skeleton-pulse 1.2s ease-in-out infinite",
        }}
      />
      <div
        style={{
          height: 16,
          width: "60%",
          background: "var(--surface2, #1c1c1c)",
          borderRadius: 4,
          animation: "showbook-skeleton-pulse 1.2s ease-in-out infinite",
        }}
      />
      <div
        style={{
          height: 16,
          width: "45%",
          background: "var(--surface2, #1c1c1c)",
          borderRadius: 4,
          animation: "showbook-skeleton-pulse 1.2s ease-in-out infinite",
        }}
      />
      <style>{`
        @keyframes showbook-skeleton-pulse {
          0%, 100% { opacity: 0.6; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
