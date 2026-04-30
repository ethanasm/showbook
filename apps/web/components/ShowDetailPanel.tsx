"use client";

import Link from "next/link";
import { Ticket, MoreHorizontal, Trash2 } from "lucide-react";
import {
  daysUntil,
  formatDateParts,
} from "@showbook/shared";
import {
  getHeadliner,
  getHeadlinerId,
  getSupport,
  getSupportPerformers,
  type ShowLike,
} from "@/lib/show-accessors";
import type {
  ShowKind,
  ShowState,
} from "@/components/design-system";

export interface ShowDetailPanelShow extends ShowLike {
  id: string;
  kind: ShowKind;
  state: ShowState;
  date: string;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
}

const STATE_TRANSITIONS: Record<
  string,
  { label: string; target: ShowState }
> = {
  watching: { label: "Got tickets", target: "ticketed" },
  ticketed: { label: "Mark as attended", target: "past" },
};

interface ShowDetailPanelProps {
  show: ShowDetailPanelShow;
  venueName: string;
  venueId: string;
  onEdit: () => void;
  onDelete: () => void;
  onStateTransition: () => void;
}

export function ShowDetailPanel({
  show,
  venueName,
  onEdit,
  onDelete,
  onStateTransition,
}: ShowDetailPanelProps) {
  const support = getSupport(show);
  const dateParts = formatDateParts(show.date);
  const days = daysUntil(show.date);
  const countdown =
    show.state !== "past" && days > 0
      ? `in ${days} day${days !== 1 ? "s" : ""}`
      : null;
  const transition = STATE_TRANSITIONS[show.state];

  return (
    <div
      style={{
        background: "var(--surface2)",
        borderBottom: "1px solid var(--rule)",
        padding: "20px 24px 20px 34px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 24,
      }}
    >
      {/* Column 1: Details */}
      <div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 9.5,
            color: "var(--faint)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Details
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 20,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -0.5,
            lineHeight: 1.1,
          }}
        >
          {(() => {
            const hlId = getHeadlinerId(show);
            const name = getHeadliner(show);
            return hlId ? (
              <Link
                href={`/artists/${hlId}`}
                style={{ color: "inherit", textDecoration: "none" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.textDecoration = "underline")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.textDecoration = "none")
                }
              >
                {name}
              </Link>
            ) : (
              name
            );
          })()}
        </div>
        {support.length > 0 && (
          <div
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              color: "var(--muted)",
              marginTop: 5,
            }}
          >
            with{" "}
            {(() => {
              const supportRich = getSupportPerformers(show);
              return support.map((name, i) => {
                const id = supportRich.find((p) => p.name === name)?.id;
                return (
                  <span key={`${name}-${i}`}>
                    {id ? (
                      <Link
                        href={`/artists/${id}`}
                        style={{
                          color: "inherit",
                          textDecoration: "none",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.textDecoration =
                            "underline")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.textDecoration = "none")
                        }
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                    {i < support.length - 1 ? ", " : ""}
                  </span>
                );
              });
            })()}
          </div>
        )}
        {show.tourName && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              marginTop: 8,
              letterSpacing: ".04em",
            }}
          >
            {show.tourName}
          </div>
        )}
      </div>

      {/* Column 2: Venue */}
      <div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 9.5,
            color: "var(--faint)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Venue
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
          }}
        >
          {venueName}
        </div>
        {show.seat && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              marginTop: 6,
            }}
          >
            <span style={{ color: "var(--faint)" }}>seat</span> {show.seat}
          </div>
        )}
      </div>

      {/* Column 3: Date */}
      <div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 9.5,
            color: "var(--faint)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            marginBottom: 6,
          }}
        >
          Date
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--ink)",
            fontFeatureSettings: '"tnum"',
          }}
        >
          {dateParts.dow}, {dateParts.month} {dateParts.day}, {dateParts.year}
        </div>
        {countdown && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--accent)",
              marginTop: 4,
            }}
          >
            {countdown}
          </div>
        )}
        {show.pricePaid && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              marginTop: 6,
            }}
          >
            <span style={{ color: "var(--faint)" }}>paid</span> $
            {parseFloat(show.pricePaid).toFixed(0)}
            {show.ticketCount > 1 && (
              <span style={{ color: "var(--faint)" }}>
                {" "}
                · ${(parseFloat(show.pricePaid) / show.ticketCount).toFixed(0)}/ea ×{" "}
                {show.ticketCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Column 4: Actions */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 9.5,
            color: "var(--faint)",
            letterSpacing: ".1em",
            textTransform: "uppercase",
            marginBottom: 2,
          }}
        >
          Actions
        </div>
        {show.state === "watching" && (
          <button
            onClick={onStateTransition}
            style={{
              padding: "8px 14px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <Ticket size={13} /> Buy tickets
          </button>
        )}
        {transition && show.state === "ticketed" && (
          <button
            onClick={onStateTransition}
            style={{
              padding: "8px 14px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            {transition.label}
          </button>
        )}
        <button
          onClick={onEdit}
          style={{
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid var(--rule-strong)",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12.5,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <MoreHorizontal size={13} /> Edit
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid var(--rule-strong)",
            color: "#E63946",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12.5,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  );
}
