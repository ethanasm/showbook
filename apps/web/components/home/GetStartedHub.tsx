"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { Eye, Music, Plus, X, ArrowRight } from "lucide-react";
import { SpotifyImportModal } from "@/components/preferences/SpotifyImportModal";

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
      subtitle: "Backfill past shows from your ticket receipts.",
      primary: true,
      href: "/logbook?gmail=1",
    },
    {
      id: "discover",
      icon: <Eye size={16} color="var(--accent)" />,
      title: "Find shows in Discover",
      subtitle: "See announcements from venues and artists you follow.",
      href: "/discover",
    },
    {
      id: "spotify",
      icon: <Music size={16} color="var(--accent)" />,
      title: "Import artists from Spotify",
      subtitle: "Powers your Discover feed (doesn't add shows directly).",
      onClick: () => setSpotifyOpen(true),
    },
    {
      id: "add",
      icon: <Plus size={16} color="var(--ink)" />,
      title: "Add a show manually",
      subtitle: "Log one you remember, or one you just bought tickets to.",
      href: "/add",
    },
  ];

  if (variant === "card") {
    return (
      <div
        data-testid="get-started-card"
        style={{
          margin: "12px 36px 0",
          padding: "14px 16px",
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
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
            }}
          >
            Backfill past shows, find upcoming events, or seed your follow
            graph.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {doors.map((d) => {
            const content = (
              <span
                key={d.id}
                title={d.subtitle}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 10px",
                  border: "1px solid var(--rule)",
                  borderRadius: 6,
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: "var(--ink)",
                  textDecoration: "none",
                  cursor: "pointer",
                  letterSpacing: ".04em",
                }}
              >
                {d.icon}
                <span>{d.title}</span>
              </span>
            );
            if (d.href) {
              return (
                <Link key={d.id} href={d.href} style={{ textDecoration: "none" }}>
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
                }}
              >
                {content}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss get started"
          style={{
            background: "none",
            border: "none",
            color: "var(--faint)",
            cursor: "pointer",
            padding: 4,
            display: "inline-flex",
          }}
        >
          <X size={14} />
        </button>
        {spotifyOpen && (
          <SpotifyImportModal
            open={spotifyOpen}
            onClose={() => setSpotifyOpen(false)}
          />
        )}
      </div>
    );
  }

  // Expanded variant — full empty-state hub.
  return (
    <div
      data-testid="get-started-hub"
      style={{
        height: "100%",
        padding: "48px 24px",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 640,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 28,
        }}
      >
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

        <div
          style={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 12,
          }}
        >
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
