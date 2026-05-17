"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: "#0C0C0C",
          color: "#F5F5F3",
          fontFamily: "system-ui, -apple-system, sans-serif",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            maxWidth: 480,
            border: "1px solid rgba(245,245,243,.22)",
            background: "#141414",
            padding: "28px 32px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: ".12em",
              textTransform: "uppercase",
              color: "rgba(245,245,243,.55)",
              marginBottom: 14,
            }}
          >
            Showbook
          </div>
          <h1 style={{ fontSize: 22, margin: "0 0 10px", fontWeight: 600 }}>
            Something broke badly.
          </h1>
          <p
            style={{
              margin: "0 0 22px",
              color: "rgba(245,245,243,.65)",
              lineHeight: 1.5,
              fontSize: 14,
            }}
          >
            The app couldn&apos;t recover on its own. Try reloading. If the page
            still doesn&apos;t come back, sign out and back in.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "9px 18px",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              background: "#F5F5F3",
              color: "#0C0C0C",
              border: "1px solid #F5F5F3",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest ? (
            <div
              style={{
                marginTop: 18,
                fontSize: 10.5,
                color: "rgba(245,245,243,.32)",
                letterSpacing: ".06em",
              }}
            >
              ref: {error.digest}
            </div>
          ) : null}
        </div>
      </body>
    </html>
  );
}
