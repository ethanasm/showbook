"use client";

import Link from "next/link";
import { EmptyState } from "@/components/design-system/EmptyState";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <EmptyState
      kind="shows"
      title="Something went wrong"
      body="The page hit an unexpected error. Try again — if it keeps happening, refresh or head home."
      action={
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              background: "var(--ink)",
              color: "var(--bg)",
              border: "1px solid var(--ink)",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link
            href="/home"
            style={{
              padding: "8px 16px",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              background: "transparent",
              color: "var(--ink)",
              border: "1px solid var(--rule-strong)",
              textDecoration: "none",
            }}
          >
            Back to home
          </Link>
          {error.digest ? (
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 11.5,
                color: "var(--faint)",
              }}
            >
              ref: {error.digest}
            </span>
          ) : null}
        </div>
      }
    />
  );
}
