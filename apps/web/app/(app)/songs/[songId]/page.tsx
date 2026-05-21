"use client";

import { useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ExternalLink, Music } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { CenteredMessage, QueryBoundary } from "@/components/design-system";
import { formatDateLong, formatDateMedium } from "@showbook/shared";

export default function SongDetailPage() {
  const params = useParams<{ songId: string }>();
  const router = useRouter();
  const songId = params?.songId ?? "";

  const detailQuery = trpc.songs.byId.useQuery(
    { songId },
    { enabled: Boolean(songId) },
  );

  // Fire one telemetry ping per (mount, songId) pair.
  const telemetryFired = useRef<string | null>(null);
  useEffect(() => {
    if (!songId) return;
    if (telemetryFired.current === songId) return;
    telemetryFired.current = songId;
    void fetch("/api/telemetry/songs-view", {
      method: "POST",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surface: "detail", songId }),
    }).catch(() => {
      // best-effort.
    });
  }, [songId]);

  return (
    <QueryBoundary
      query={detailQuery}
      loadingLabel="Loading song…"
      errorFallback={() => (
        <CenteredMessage tone="error">
          Couldn&apos;t load this song.{" "}
          <button
            type="button"
            onClick={() => router.push("/songs")}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "inherit",
            }}
          >
            back to songs →
          </button>
        </CenteredMessage>
      )}
    >
      {(data) => {
        const { song, timesHeard, firstHeard, lastHeard, timeline, rarity } = data;
        const sparklinePoints = computeSparklinePoints(timeline);
        return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Breadcrumb */}
      <div
        style={{
          padding: "14px var(--page-pad-x)",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: ".04em",
        }}
      >
        <Link
          href="/songs"
          style={{ color: "var(--muted)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          <ChevronLeft size={12} /> songs
        </Link>
        <span style={{ color: "var(--faint)" }}>/</span>
        <Link
          href={`/artists/${song.performerId}`}
          style={{ color: "var(--muted)", textDecoration: "none" }}
        >
          {song.performerName.toLowerCase()}
        </Link>
      </div>

      {/* Hero */}
      <div style={{ padding: "26px var(--page-pad-x) 22px", borderBottom: "1px solid var(--rule)" }}>
        <div className="eyebrow">Song you&apos;ve heard live</div>
        <h1
          className="display-title"
          style={{
            margin: 0,
            marginTop: 6,
            fontSize: 38,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.05,
            color: "var(--ink)",
          }}
        >
          &ldquo;{song.title}&rdquo;
        </h1>
        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link
            href={`/artists/${song.performerId}`}
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 16,
              fontWeight: 500,
              color: "var(--muted)",
              textDecoration: "none",
            }}
          >
            {song.performerName}
          </Link>
          {song.spotifyTrackId && song.spotifyTrackId !== "__none__" && (
            <a
              href={`https://open.spotify.com/track/${song.spotifyTrackId}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="song-spotify-link"
              style={{
                padding: "5px 10px",
                border: "1px solid var(--rule-strong)",
                color: "var(--ink)",
                textDecoration: "none",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10.5,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Music size={11} /> Open in Spotify
              <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>

      {/* Stats strip */}
      <div
        style={{
          padding: "16px var(--page-pad-x)",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          columnGap: 28,
          rowGap: 12,
        }}
      >
        <Stat label="Heard live" value={`${timesHeard} time${timesHeard === 1 ? "" : "s"}`} />
        {firstHeard && (
          <Stat
            label="First"
            value={formatDateLong(firstHeard.date)}
            sub={firstHeard.venueName}
            href={firstHeard.showId ? `/shows/${firstHeard.showId}` : undefined}
          />
        )}
        {lastHeard && lastHeard.date !== firstHeard?.date && (
          <Stat
            label="Most recent"
            value={formatDateLong(lastHeard.date)}
            sub={lastHeard.venueName}
            href={lastHeard.showId ? `/shows/${lastHeard.showId}` : undefined}
          />
        )}
        {rarity && (
          <Stat
            label="In recent setlists"
            value={`${rarity.fractionPct}%`}
            sub={`${rarity.corpusHits} of ${rarity.corpusTotal} on this tour`}
          />
        )}
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          padding: "26px var(--page-pad-x) 48px",
          display: "flex",
          flexDirection: "column",
          gap: 32,
        }}
      >
        {timeline.length >= 2 && sparklinePoints && (
          <section>
            <SectionLabel>Where it tends to land in the set</SectionLabel>
            <Sparkline points={sparklinePoints} />
          </section>
        )}

        <section>
          <SectionLabel>
            Your shows where it played &middot; {timeline.length}
          </SectionLabel>
          <div
            style={{ background: "var(--surface)" }}
            data-testid="song-show-list"
          >
            {timeline.map((row, idx) => (
              <Link
                key={`${row.showId ?? idx}-${row.date}`}
                href={row.showId ? `/shows/${row.showId}` : "#"}
                style={{
                  display: "grid",
                  gridTemplateColumns: "112px 1fr 80px",
                  columnGap: 18,
                  padding: "14px 20px",
                  borderBottom: "1px solid var(--rule)",
                  alignItems: "baseline",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    color: "var(--muted)",
                    letterSpacing: ".04em",
                  }}
                >
                  {formatDateMedium(row.date)}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-geist-sans), sans-serif",
                    fontSize: 14,
                    fontWeight: 500,
                    color: "var(--ink)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.venueName}
                  {row.venueCity && (
                    <span
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11,
                        color: "var(--muted)",
                        marginLeft: 8,
                        letterSpacing: ".02em",
                      }}
                    >
                      &middot; {row.venueCity}
                    </span>
                  )}
                </div>
                <div
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10.5,
                    color: row.isEncore ? "var(--accent)" : "var(--faint)",
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                  }}
                >
                  {row.isEncore ? "Encore" : `Pos ${row.songIndex + 1}`}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
        );
      }}
    </QueryBoundary>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string | null;
  href?: string;
}) {
  const body = (
    <>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 9.5,
          color: "var(--faint)",
          letterSpacing: ".12em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink)",
          letterSpacing: -0.2,
        }}
      >
        {value}
      </div>
      {sub && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
            marginTop: 4,
            letterSpacing: ".02em",
          }}
        >
          {sub}
        </div>
      )}
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        style={{ textDecoration: "none", color: "inherit", display: "block" }}
      >
        {body}
      </Link>
    );
  }
  return <div>{body}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 10.5,
        color: "var(--muted)",
        letterSpacing: ".1em",
        textTransform: "uppercase",
        marginBottom: 10,
      }}
    >
      {children}
    </div>
  );
}

interface SparklineTimelinePoint {
  date: string;
  sectionIndex: number;
  songIndex: number;
  isEncore: boolean;
}

/**
 * Normalize the timeline into 0..1 (x = chronological order, y =
 * position-in-set scaled by the max song-index across the timeline so
 * the sparkline reads "earlier vs later in the show" without us
 * having to compute setlist length per row). Pure helper (not a hook
 * — but named like one so the page-level call lives at the top of the
 * component for readability).
 */
function computeSparklinePoints(
  timeline: SparklineTimelinePoint[],
): Array<{ x: number; y: number; isEncore: boolean }> | null {
  if (timeline.length < 2) return null;
  const maxPosition = Math.max(
    ...timeline.map((r) => (r.isEncore ? r.songIndex + 24 : r.songIndex)),
    1,
  );
  return timeline.map((row, idx) => ({
    x: idx / Math.max(1, timeline.length - 1),
    y:
      (row.isEncore ? row.songIndex + 24 : row.songIndex) /
      Math.max(1, maxPosition),
    isEncore: row.isEncore,
  }));
}

function Sparkline({
  points,
}: {
  points: Array<{ x: number; y: number; isEncore: boolean }>;
}) {
  const W = 320;
  const H = 60;
  const PAD = 6;
  const path = points
    .map((p, i) => {
      const x = PAD + p.x * (W - PAD * 2);
      const y = H - PAD - p.y * (H - PAD * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div
      data-testid="song-position-sparkline"
      style={{
        background: "var(--surface)",
        padding: "14px 20px",
        border: "1px solid var(--rule)",
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        preserveAspectRatio="none"
        role="img"
        aria-label="Position in setlist across plays"
      >
        <path d={path} stroke="var(--accent)" strokeWidth={1.5} fill="none" />
        {points.map((p, i) => {
          const x = PAD + p.x * (W - PAD * 2);
          const y = H - PAD - p.y * (H - PAD * 2);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={p.isEncore ? 3 : 2}
              fill={p.isEncore ? "var(--accent)" : "var(--ink)"}
            />
          );
        })}
      </svg>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 9.5,
          color: "var(--faint)",
          letterSpacing: ".06em",
          textTransform: "uppercase",
        }}
      >
        <span>Earliest play</span>
        <span>Most recent</span>
      </div>
    </div>
  );
}
