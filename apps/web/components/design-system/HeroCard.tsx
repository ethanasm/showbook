"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import "./design-system.css";
import type { ShowKind } from "./KindBadge";
import { KindSwatch } from "./KindSwatch";
import { useLiveCountdown } from "@/lib/useLiveCountdown";

export interface HeroShow {
  id?: string;
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
  /**
   * Raw calendar date (YYYY-MM-DD) of the show. When provided, the
   * hero label upgrades to a live-ticking countdown inside the last
   * 48 h (h-min beyond an hour, hh:mm:ss inside the last hour).
   * Falls back to the static `countdown` string when omitted.
   */
  dateYmd?: string | null;
  hasTix: boolean;
  headlinerImageUrl?: string | null;
}

interface HeroCardProps {
  show: HeroShow;
}

/**
 * The hero spells the weekday out (`Friday`), where list rows keep the
 * three-letter form the shared date formatter returns. It's the one date on
 * the screen with room for it.
 */
const LONG_DOW: Record<string, string> = {
  Sun: "Sunday",
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};

export function HeroCard({ show }: HeroCardProps) {
  const router = useRouter();
  const kindColor = `var(--kind-${show.kind})`;
  const showId = show.id;
  // Live ticker — falls through to the static countdown when no dateYmd
  // was provided (callers that haven't been migrated yet still render
  // the calendar-day label as before).
  const live = useLiveCountdown(show.dateYmd ?? null, {
    fallback: show.countdown,
  });
  const countdownLabel = show.dateYmd ? live : show.countdown;

  return (
    <div
      className="hero-card"
      data-testid={showId ? "hero-card" : undefined}
      data-show-id={showId}
      onClick={showId ? () => router.push(`/shows/${showId}`) : undefined}
      style={{
        borderLeft: `3px solid ${kindColor}`,
        cursor: showId ? "pointer" : undefined,
      }}
    >
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
          {/* Kind marker. The "Next up · in N days · doors 7:00 pm" pulse
              label moved out to the section eyebrow above the card, and the
              gold-bordered Ticketed chip became a word after the kind — so
              the card opens on the headliner rather than on three
              competing labels. */}
          <div style={{ marginBottom: 12 }}>
            <KindSwatch
              kind={show.kind}
              suffix={show.hasTix ? "· Ticketed" : undefined}
            />
          </div>

          {/* Headliner */}
          <div className="hero-card__title">
            {show.headlinerId ? (
              <Link
                href={`/artists/${show.headlinerId}`}
                onClick={(e) => e.stopPropagation()}
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
                        onClick={(e) => e.stopPropagation()}
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

          {/* Meta row — labelled columns */}
          <div className="hero-card__meta">
            <div>
              <div className="hero-card__meta-label">Venue</div>
              <div className="hero-card__meta-value">
                {show.venueId ? (
                  <Link
                    href={`/venues/${show.venueId}`}
                    onClick={(e) => e.stopPropagation()}
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
              <div className="hero-card__meta-sub">{show.city}</div>
            </div>

            <div>
              <div className="hero-card__meta-label">Doors</div>
              <div className="hero-card__meta-value">7:00 pm</div>
              <div className="hero-card__meta-sub">Show 8:00 pm</div>
            </div>

            <div>
              <div className="hero-card__meta-label">Paid</div>
              <div className="hero-card__meta-value">${show.paid}</div>
              {show.seat && (
                <div className="hero-card__meta-sub">{show.seat}</div>
              )}
            </div>
          </div>
        </div>

        {/* Right side — date column. On mobile this becomes a horizontal
            strip below the headliner so the day digit doesn't crowd the title. */}
        <div className="hero-card__date">
          <div
            className="hero-card__date-dow"
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              color: "var(--muted)",
            }}
          >
            {LONG_DOW[show.date.dow] ?? show.date.dow}
          </div>
          <div className="hero-card__date-headline">
            <span className="hero-card__date-day">{show.date.day}</span>
            <span className="hero-card__date-month">{show.date.month}</span>
          </div>
          <div
            className="hero-card__date-countdown"
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              color: "var(--muted)",
            }}
          >
            {countdownLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
