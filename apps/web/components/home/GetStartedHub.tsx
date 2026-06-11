"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, Music, Plus, X, ArrowRight, Mail, Ticket, Check, Circle } from "lucide-react";
import { isFeatureOn } from "@showbook/shared";
import { useDismissableFlag } from "@/lib/dismissable-flag";
import { SpotifyImportModal } from "@/components/preferences/SpotifyImportModal";
import "@/components/design-system/design-system.css";

const STORAGE_KEY = "showbook:get-started-dismissed";
const MONO = "var(--font-geist-mono), monospace";

export function useGetStartedDismissed() {
  return useDismissableFlag(STORAGE_KEY);
}

type Variant = "expanded" | "card";

/**
 * One row of the Get Started checklist (card variant). Steps are
 * computed by the home view from live queries — the hub stays
 * presentational so it renders without a tRPC provider.
 */
export interface GetStartedStep {
  id: string;
  label: string;
  done: boolean;
  href: string;
}

interface Door {
  id: string;
  icon: React.ReactNode;
  title: string;
  // Shorter label used in the card variant on mobile, where the
  // 2-column grid can't fit the full "Import from …" sentence.
  shortTitle: string;
  subtitle: string;
  primary?: boolean;
  href?: string;
  onClick?: () => void;
}

export function GetStartedHub({
  variant,
  onDismiss,
  steps,
}: {
  variant: Variant;
  onDismiss?: () => void;
  /** Checklist rows for the card variant; ignored by `expanded`. */
  steps?: GetStartedStep[];
}) {
  const [spotifyOpen, setSpotifyOpen] = useState(false);

  const eventbriteEnabled = isFeatureOn("EventbriteImportEnabled");

  const doors: Door[] = [
    {
      id: "gmail",
      icon: <Image src="/google-g.svg" alt="" width={16} height={16} />,
      title: "Import from Gmail",
      shortTitle: "Gmail",
      subtitle: "Backfill past shows from your ticket receipts.",
      primary: true,
      href: "/logbook?import=gmail",
    },
    {
      id: "setlistfm",
      icon: <Mail size={16} color="var(--accent)" />,
      title: "Import from setlist.fm",
      shortTitle: "setlist.fm",
      subtitle: "Pull every concert you've marked attended (with setlists).",
      primary: true,
      href: "/logbook?import=setlistfm",
    },
    ...(eventbriteEnabled
      ? [
          {
            id: "eventbrite",
            icon: <Ticket size={16} color="var(--accent)" />,
            title: "Import from Eventbrite",
            shortTitle: "Eventbrite",
            subtitle: "Past orders for indie shows, comedy, theatre.",
            primary: true,
            href: "/logbook?import=eventbrite",
          } satisfies Door,
        ]
      : []),
    {
      id: "spotify",
      icon: <Music size={16} color="var(--accent)" />,
      title: "Follow your Spotify artists",
      shortTitle: "Spotify",
      subtitle: "Seeds Discover with their announcements — it won't add shows.",
      primary: true,
      onClick: () => setSpotifyOpen(true),
    },
    {
      id: "discover",
      icon: <Eye size={16} color="var(--accent)" />,
      title: "Find shows in Discover",
      shortTitle: "Discover",
      subtitle: "See announcements from venues and artists you follow.",
      href: "/discover",
    },
    {
      id: "add",
      icon: <Plus size={16} color="var(--ink)" />,
      title: "Add a show manually",
      shortTitle: "Add manually",
      subtitle: "Log one you remember, or one you just bought tickets to.",
      href: "/add",
    },
  ];

  if (variant === "card") {
    const checklist = steps ?? [];
    const doneCount = checklist.filter((s) => s.done).length;
    return (
      <div className="get-started-card" data-testid="get-started-card">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss get started"
          className="get-started-card__dismiss"
        >
          <X size={14} />
        </button>
        <div className="get-started-card__copy">
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 10,
              marginBottom: 4,
            }}
          >
            <div
              style={{
                fontFamily: MONO,
                fontSize: 10,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                color: "var(--faint)",
              }}
            >
              Get started
            </div>
            {checklist.length > 0 && (
              <div
                data-testid="get-started-progress"
                style={{
                  fontFamily: MONO,
                  fontSize: 10,
                  color: "var(--accent)",
                  letterSpacing: ".06em",
                  fontFeatureSettings: '"tnum"',
                }}
              >
                {doneCount} of {checklist.length}
              </div>
            )}
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 12,
              color: "var(--muted)",
              letterSpacing: ".02em",
              lineHeight: 1.5,
            }}
          >
            A couple of steps and Showbook starts working for you.
          </div>
        </div>
        <div className="get-started-card__steps">
          {checklist.map((s) =>
            s.done ? (
              <span
                key={s.id}
                data-testid={`get-started-step-${s.id}`}
                className="get-started-card__step get-started-card__step--done"
              >
                <Check size={13} color="var(--accent)" strokeWidth={2.4} />
                <span className="get-started-card__step-label">{s.label}</span>
              </span>
            ) : (
              <Link
                key={s.id}
                href={s.href}
                data-testid={`get-started-step-${s.id}`}
                className="get-started-card__step"
              >
                <Circle size={11} color="var(--faint)" strokeWidth={2} />
                <span className="get-started-card__step-label">{s.label}</span>
                <ArrowRight size={11} color="var(--accent)" />
              </Link>
            ),
          )}
        </div>
      </div>
    );
  }

  // Expanded variant — full empty-state hub. On mobile we leave the layout
  // top-aligned with extra bottom padding so the bottom row of doors clears
  // the fixed bottom nav; on desktop we still vertically center the hub.
  return (
    <div className="get-started-hub" data-testid="get-started-hub">
      <div className="get-started-hub__inner">
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--faint)",
            }}
          >
            Get started
          </div>
          <h1
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 28,
              fontWeight: 600,
              color: "var(--ink)",
              letterSpacing: -0.4,
              margin: 0,
            }}
          >
            Build your <span className="gradient-emphasis">showbook</span>
          </h1>
          <p
            style={{
              fontFamily: MONO,
              fontSize: 12,
              color: "var(--muted)",
              letterSpacing: ".02em",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Pick a door. You can always come back to add more later.
          </p>
        </div>

        <div className="get-started-hub__doors">
          {doors.map((d) => {
            const cardContent = (
              <div
                style={{
                  padding: "16px 16px",
                  background: d.primary ? "var(--surface)" : "transparent",
                  border: d.primary
                    ? "1px solid var(--accent)"
                    : "1px solid var(--rule)",
                  borderRadius: 8,
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  height: "100%",
                  textAlign: "left",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--surface2, var(--surface))";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = d.primary
                    ? "var(--surface)"
                    : "transparent";
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {d.icon}
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--ink)",
                      letterSpacing: ".04em",
                    }}
                  >
                    {d.title}
                  </span>
                  <span style={{ flex: 1 }} />
                  <ArrowRight size={12} color="var(--faint)" />
                </div>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 11,
                    color: "var(--muted)",
                    letterSpacing: ".02em",
                    lineHeight: 1.5,
                  }}
                >
                  {d.subtitle}
                </div>
              </div>
            );
            if (d.href) {
              return (
                <Link
                  key={d.id}
                  href={d.href}
                  data-testid={`get-started-door-${d.id}`}
                  style={{ textDecoration: "none" }}
                >
                  {cardContent}
                </Link>
              );
            }
            return (
              <button
                key={d.id}
                type="button"
                onClick={d.onClick}
                data-testid={`get-started-door-${d.id}`}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                {cardContent}
              </button>
            );
          })}
        </div>
      </div>
      {spotifyOpen && (
        <SpotifyImportModal
          open={spotifyOpen}
          onClose={() => setSpotifyOpen(false)}
        />
      )}
    </div>
  );
}
