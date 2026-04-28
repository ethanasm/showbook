"use client";

import Link from "next/link";
import "./design-system.css";
import type { ShowKind } from "./KindBadge";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  MapPin,
  Ticket,
  Clock,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface HeroShow {
  headliner: string;
  headlinerId?: string;
  support: string[];
  supportPerformers?: { id: string; name: string }[];
  venue: string;
  venueId?: string;
  city: string;
  seat: string;
  paid: number;
  kind: ShowKind;
  date: { month: string; day: string; year: string; dow: string };
  countdown: string;
  hasTix: boolean;
}

interface HeroCardProps {
  show: HeroShow;
}

const KIND_ICONS: Record<ShowKind, LucideIcon> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

const KIND_LABELS: Record<ShowKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
};

export function HeroCard({ show }: HeroCardProps) {
  const KindIcon = KIND_ICONS[show.kind];
  const kindColor = `var(--kind-${show.kind})`;

  return (
    <div
      style={{
        padding: "28px 32px",
        background: "var(--surface)",
        borderLeft: `3px solid ${kindColor}`,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 32,
        alignItems: "center",
      }}
    >
      {/* Left side */}
      <div style={{ minWidth: 0 }}>
        {/* Kind badge + Ticketed chip row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: kindColor,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              fontWeight: 500,
            }}
          >
            <KindIcon size={13} color={kindColor} />
            {KIND_LABELS[show.kind]}
          </span>
          {show.hasTix && (
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                color: "var(--ink)",
                padding: "3px 8px",
                border: "1px solid var(--accent)",
                letterSpacing: ".06em",
                textTransform: "uppercase",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <Check size={11} color="var(--accent)" /> Ticketed
            </span>
          )}
        </div>

        {/* Headliner */}
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 52,
            fontWeight: 600,
            letterSpacing: -2,
            color: "var(--ink)",
            lineHeight: 0.95,
          }}
        >
          {show.headlinerId ? (
            <Link
              href={`/artists/${show.headlinerId}`}
              style={{ color: "inherit", textDecoration: "none" }}
              onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
              onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
            >
              {show.headliner}
            </Link>
          ) : (
            show.headliner
          )}
        </div>

        {/* Support artists */}
        {show.support.length > 0 && (
          <div
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 16,
              color: "var(--muted)",
              marginTop: 8,
              letterSpacing: -0.2,
            }}
          >
            with{" "}
            {show.support.map((name, i) => {
              const id = show.supportPerformers?.find((p) => p.name === name)?.id;
              return (
                <span key={`${name}-${i}`}>
                  {id ? (
                    <Link
                      href={`/artists/${id}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                      onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                      onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                    >
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                  {i < show.support.length - 1 ? ", " : ""}
                </span>
              );
            })}
          </div>
        )}

        {/* Meta row */}
        <div
          style={{
            display: "flex",
            gap: 32,
            marginTop: 22,
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 13,
            color: "var(--ink)",
          }}
        >
          {/* Venue */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <MapPin size={14} color="var(--muted)" />
            <div>
              <div>
                {show.venueId ? (
                  <Link
                    href={`/venues/${show.venueId}`}
                    style={{ color: "inherit", textDecoration: "none" }}
                    onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                    onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                  >
                    {show.venue}
                  </Link>
                ) : (
                  show.venue
                )}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                {show.city}
              </div>
            </div>
          </div>

          {/* Seat */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Ticket size={14} color="var(--muted)" />
            <div>
              <div>{show.seat}</div>
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                ${show.paid} &middot; paid
              </div>
            </div>
          </div>

          {/* Doors / Show time */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <Clock size={14} color="var(--muted)" />
            <div>
              <div>doors 7:00 pm</div>
              <div
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  marginTop: 2,
                }}
              >
                show 8:00 pm
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right side — date column */}
      <div
        style={{
          textAlign: "center",
          paddingLeft: 32,
          borderLeft: "1px solid var(--rule)",
          minWidth: 180,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: kindColor,
            letterSpacing: ".12em",
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          {show.date.dow}
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 120,
            fontWeight: 500,
            color: "var(--ink)",
            letterSpacing: -5,
            lineHeight: 0.85,
            fontFeatureSettings: '"tnum"',
            marginTop: 4,
          }}
        >
          {show.date.day}
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 12,
            color: "var(--ink)",
            letterSpacing: ".14em",
            marginTop: 4,
            textTransform: "uppercase",
            fontWeight: 500,
          }}
        >
          {show.date.month}
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
            marginTop: 10,
            letterSpacing: ".06em",
          }}
        >
          {show.countdown}
        </div>
      </div>
    </div>
  );
}
