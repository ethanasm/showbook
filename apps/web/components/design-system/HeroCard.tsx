"use client";

import Image from "next/image";
import Link from "next/link";
import "./design-system.css";
import type { ShowKind } from "./KindBadge";
import { PulseLabel } from "./PulseLabel";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  MapPin,
  Ticket,
  Clock,
  Check,
} from "lucide-react";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";

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
  headlinerImageUrl?: string | null;
}

interface HeroCardProps {
  show: HeroShow;
}

export function HeroCard({ show }: HeroCardProps) {
  const KindIcon = KIND_ICONS[show.kind];
  const kindColor = `var(--kind-${show.kind})`;
  const isMobile = useIsMobile();

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        padding: isMobile ? "20px 18px" : "28px 32px",
        background: "var(--surface)",
        border: "1px solid var(--rule)",
        borderRadius: 12,
        borderLeft: `3px solid ${kindColor}`,
      }}
    >
      <div className="glow-backdrop" style={{ opacity: 0.55 }} />
      {show.headlinerImageUrl && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            left: "38%",
            zIndex: 0,
            opacity: 0.28,
          }}
          aria-hidden="true"
        >
          <Image
            src={show.headlinerImageUrl}
            alt=""
            fill
            sizes="(max-width: 768px) 100vw, 560px"
            // Bias the crop toward the top of the source image — band/artist
            // photos almost always have faces in the upper third, and the
            // hero's wide aspect ratio cuts off the top with the default
            // center-center position.
            style={{ objectFit: "cover", objectPosition: "center 25%" }}
            priority
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(90deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 82%, transparent) 28%, transparent 100%)",
            }}
          />
        </div>
      )}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr auto",
          gap: isMobile ? 20 : 32,
          alignItems: "center",
      }}
    >
      {/* Left side */}
      <div style={{ minWidth: 0 }}>
        <div style={{ marginBottom: 16 }}>
          <PulseLabel>
            Next up &middot; {show.countdown} &middot; doors 7:00 pm
          </PulseLabel>
        </div>

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
            fontFamily: "var(--font-display)",
            fontSize: isMobile ? 36 : 52,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            color: "var(--ink)",
            lineHeight: 1.1,
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
            letterSpacing: 0,
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
            flexDirection: isMobile ? "column" : "row",
            gap: isMobile ? 12 : 32,
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
          paddingLeft: isMobile ? 0 : 32,
          paddingTop: isMobile ? 14 : 0,
          borderLeft: isMobile ? "none" : "1px solid var(--rule)",
          borderTop: isMobile ? "1px solid var(--rule)" : "none",
          minWidth: isMobile ? 0 : 180,
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
            fontSize: isMobile ? 88 : 120,
            fontWeight: 500,
            letterSpacing: 0,
            lineHeight: 0.85,
            fontFeatureSettings: '"tnum"',
            marginTop: 4,
          }}
          className="gradient-emphasis"
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
    </div>
  );
}
