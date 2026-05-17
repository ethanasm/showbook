import Link from "next/link";
import { EmptyState } from "@/components/design-system/EmptyState";

export default function AppNotFound() {
  return (
    <EmptyState
      kind="shows"
      title="Couldn't find that page"
      body="The link you followed doesn't lead anywhere we know about. Try one of these instead."
      action={
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <Link
            href="/home"
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              background: "var(--ink)",
              color: "var(--bg)",
              border: "1px solid var(--ink)",
              textDecoration: "none",
            }}
          >
            Home
          </Link>
          <Link
            href="/upcoming"
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              background: "transparent",
              color: "var(--ink)",
              border: "1px solid var(--rule-strong)",
              textDecoration: "none",
            }}
          >
            Upcoming
          </Link>
          <Link
            href="/logbook"
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              background: "transparent",
              color: "var(--ink)",
              border: "1px solid var(--rule-strong)",
              textDecoration: "none",
            }}
          >
            Logbook
          </Link>
        </div>
      }
    />
  );
}
