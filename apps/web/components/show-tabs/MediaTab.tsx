"use client";

import type { ReactNode } from "react";
import { SectionFrame } from "./SectionFrame";
import "./show-tabs.css";

interface MediaTabProps {
  isPast: boolean;
  /** Mounted children — the existing `<MediaSection>` from the legacy page. */
  mediaSection: ReactNode;
  mediaCount: number;
}

const AUTO_STUBS = [
  { emoji: "🎫", title: "Ticket stub", sub: "from Apple Wallet" },
  { emoji: "🎵", title: "Live playlist", sub: "after setlist syncs" },
  { emoji: "📍", title: "Map of venue", sub: "Google Places" },
];

const PAST_STUBS = [
  { emoji: "🎫", title: "Ticket stub", sub: "Apple Wallet" },
  { emoji: "🎵", title: "I-heard playlist", sub: "after setlist syncs" },
  { emoji: "📍", title: "Venue map", sub: "tap for walk-out gif" },
];

/**
 * Media tab body. The actual photo grid is whatever upload-aware
 * component the show-detail page passes in (Phase 1 reuses the
 * legacy `<MediaSection>` from `apps/web/components/media/`). Below
 * the grid we render the "what we'll add automatically" stubs from
 * the handoff so the empty state explains the future shape.
 */
export function MediaTab({ isPast, mediaSection, mediaCount }: MediaTabProps) {
  const stubs = isPast ? PAST_STUBS : AUTO_STUBS;
  const stubTitle = isPast ? "From the night" : "What we'll add automatically";

  return (
    <div data-testid="show-tab-media">
      <SectionFrame title="Photos" count={mediaCount}>
        {mediaSection}
      </SectionFrame>
      <SectionFrame title={stubTitle}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 8,
          }}
        >
          {stubs.map((stub) => (
            <div
              key={stub.title}
              style={{
                padding: "14px 16px",
                background: "var(--surface)",
                border: "1px solid var(--rule)",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ fontSize: 16 }} aria-hidden="true">
                {stub.emoji}
              </span>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 13.5,
                    color: "var(--ink)",
                    fontWeight: 500,
                  }}
                >
                  {stub.title}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10,
                    color: "var(--muted)",
                    marginTop: 2,
                  }}
                >
                  {stub.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionFrame>
    </div>
  );
}
