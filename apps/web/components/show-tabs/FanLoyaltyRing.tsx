"use client";

import { trpc } from "@/lib/trpc";
import "./show-tabs.css";

interface FanLoyaltyRingProps {
  showId: string;
  /** Tighter ring + label for the right-rail variant. */
  compact?: boolean;
}

/**
 * Phase 7 — fan-loyalty donut. "You knew X of N played." Renders on
 * the Overview tab (past shows) and the desktop right rail.
 *
 * Slot vs data:
 *   - Phase 1 reserved the slot via `MusicLayerEmpty variant="fan-loyalty"`.
 *   - This component replaces the placeholder when the feature flag is
 *     on AND the show has resolved-to-Spotify songs to count against.
 *     Falls back to a tight empty state for unconnected users or
 *     unresolved setlists.
 */
export function FanLoyaltyRing({ showId, compact = false }: FanLoyaltyRingProps) {
  const query = trpc.setlistIntel.fanLoyalty.useQuery(
    { showId },
    { staleTime: 60_000 },
  );

  if (query.isLoading) {
    return (
      <div
        className="fan-loyalty-ring fan-loyalty-ring--loading"
        data-testid="fan-loyalty-ring-loading"
        aria-hidden="true"
      />
    );
  }
  if (!query.data) return null;
  if (!query.data.connected) {
    return (
      <div className="fan-loyalty-ring__empty" data-testid="fan-loyalty-ring-disconnected">
        <div className="fan-loyalty-ring__empty-title">Fan loyalty</div>
        <div className="fan-loyalty-ring__empty-body">
          Connect Spotify to see how many of these songs were already in your library.
        </div>
      </div>
    );
  }
  if (query.data.noData || query.data.totalCount === 0) {
    return (
      <div className="fan-loyalty-ring__empty" data-testid="fan-loyalty-ring-no-data">
        <div className="fan-loyalty-ring__empty-title">Fan loyalty</div>
        <div className="fan-loyalty-ring__empty-body">
          We haven&rsquo;t pinned this setlist to Spotify yet — check back after
          the next nightly resolver pass.
        </div>
      </div>
    );
  }

  const { savedCount, totalCount, playedCount } = query.data;
  const pct = Math.round((savedCount / totalCount) * 100);
  const size = compact ? 92 : 112;
  const stroke = compact ? 3 : 4;
  const radius = size / 2 - stroke * 2;
  const circumference = 2 * Math.PI * radius;
  const dashFilled = (pct / 100) * circumference;
  const denominator = playedCount || totalCount;

  return (
    <div
      className={`fan-loyalty-ring${compact ? " fan-loyalty-ring--compact" : ""}`}
      data-testid="fan-loyalty-ring"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--rule-strong)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeDasharray={`${dashFilled} ${circumference - dashFilled}`}
          strokeDashoffset={circumference / 4}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeLinecap="square"
        />
        <text
          x={size / 2}
          y={size / 2 + 1}
          fill="var(--ink)"
          fontFamily="var(--font-geist-sans), sans-serif"
          fontSize={size * 0.3}
          fontWeight={500}
          textAnchor="middle"
          dominantBaseline="middle"
          letterSpacing="-1"
        >
          {pct}
          <tspan fontSize={size * 0.16} fill="var(--muted)">
            %
          </tspan>
        </text>
      </svg>
      <div className="fan-loyalty-ring__label">
        <div className="fan-loyalty-ring__kicker">Fan loyalty</div>
        <div className="fan-loyalty-ring__count" data-testid="fan-loyalty-ring-count">
          You knew {savedCount} of {denominator} played
        </div>
        <div className="fan-loyalty-ring__sub">
          {totalCount < denominator
            ? `${totalCount} matched on Spotify`
            : "in your library before walking in"}
        </div>
      </div>
    </div>
  );
}
