"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, Music, Plus, X, ArrowRight, Mail, Ticket } from "lucide-react";
import { SpotifyImportModal } from "@/components/preferences/SpotifyImportModal";
import "@/components/design-system/design-system.css";

const STORAGE_KEY = "showbook:get-started-dismissed";
const MONO = "var(--font-geist-mono), monospace";

export function useGetStartedDismissed() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // localStorage unavailable (private mode, SSR) — treat as not dismissed.
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore — UI still flips via state below
    }
    setDismissed(true);
  }, []);

  return { dismissed, dismiss };
}

type Variant = "expanded" | "card";

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
}: {
  variant: Variant;
  onDismiss?: () => void;
}) {
  const [spotifyOpen, setSpotifyOpen] = useState(false);

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
    {
      id: "eventbrite",
      icon: <Ticket size={16} color="var(--accent)" />,
      title: "Import from Eventbrite",
      shortTitle: "Eventbrite",
      subtitle: "Past orders for indie shows, comedy, theatre.",
      primary: true,
      href: "/logbook?import=eventbrite",
    },
    {
      id: "spotify",
      icon: <Music size={16} color="var(--accent)" />,
      title: "Import artists from Spotify",
      shortTitle: "Spotify",
      subtitle: "Powers your Discover feed (doesn't add shows directly).",
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
              fontFamily: MONO,
              fontSize: 10,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--faint)",
              marginBottom: 4,
            }}
          >
            Get started
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
            Backfill past shows, find upcoming events, or seed your follow
            graph.
          </div>
        </div>
        <div className="get-started-card__buttons">
          {doors.map((d) => {
            const content = (
              <span
                key={d.id}
                title={d.subtitle}
                className="get-started-card__door"
              >
                {d.icon}
                <span className="get-started-card__door-label get-started-card__door-label--desktop">
                  {d.title}
                </span>
                <span className="get-started-card__door-label get-started-card__door-label--mobile">
                  {d.shortTitle}
                </span>
              </span>
            );
            if (d.href) {
              return (
                <Link
                  key={d.id}
                  href={d.href}
                  style={{ textDecoration: "none", display: "block" }}
                >
                  {content}
                </Link>
              );
            }
            return (
              <button
                key={d.id}
                type="button"
                onClick={d.onClick}
                style={{
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "block",
                  width: "100%",
                }}
              >
                {content}
              </button>
            );
          })}
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
