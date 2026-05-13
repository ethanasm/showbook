"use client";

import Image from "next/image";
import Link from "next/link";
import "./design-system.css";
import type { ShowKind } from "./KindBadge";
import { PulseLabel } from "./PulseLabel";
import { MapPin, Ticket, Clock, Check } from "lucide-react";
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

  return (
    <div className="hero-card" style={{ borderLeft: `3px solid ${kindColor}` }}>
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
      <div className="hero-card__grid">
        {/* Left side */}
        <div className="hero-card__main">
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
              flexWrap: "wrap",
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
          <div className="hero-card__title">
            {show.headlinerId ? (
              <Link
                href={`/artists/${show.headlinerId}`}
                style={{ color: "inherit", textDecoration: "none" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.textDecoration = "underline")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.textDecoration = "none")
                }
              >
                {show.headliner}
              </Link>
            ) : (
              show.headliner
            )}
          </div>

          {/* Support artists */}
          {show.support.length > 0 && (
            <div className="hero-card__support">
              with{" "}
              {show.support.map((name, i) => {
                const id = show.supportPerformers?.find(
                  (p) => p.name === name,
                )?.id;
                return (
                  <span key={`${name}-${i}`}>
                    {id ? (
                      <Link
                        href={`/artists/${id}`}
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
                    )}
                    {i < show.support.length - 1 ? ", " : ""}
                  </span>
                );
              })}
            </div>
          )}

          {/* Meta row */}
          <div className="hero-card__meta">
            {/* Venue */}
            <div
              style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
            >
              <MapPin size={14} color="var(--muted)" />
              <div>
                <div>
                  {show.venueId ? (
                    <Link
                      href={`/venues/${show.venueId}`}
                      style={{ color: "inherit", textDecoration: "none" }}
                      onMouseEnter={(e) =>
                        (e.currentTarget.style.textDecoration = "underline")
                      }
                      onMouseLeave={(e) =>
                        (e.currentTarget.style.textDecoration = "none")
                      }
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
            <div
              style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
            >
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
            <div
              style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
            >
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

        {/* Right side — date column. On mobile this becomes a horizontal
            strip below the headliner so the day digit doesn't crowd the title. */}
        <div className="hero-card__date">
          <div
            className="hero-card__date-dow"
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
            className="hero-card__date-day gradient-emphasis"
          >
            {show.date.day}
          </div>
          <div
            className="hero-card__date-month"
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
            className="hero-card__date-countdown"
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
