"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionFrame } from "./SectionFrame";
import { SpoilerCurtain } from "./SpoilerCurtain";
import { HypePlaylistCardPlaceholder } from "./HypePlaylistCardPlaceholder";
import { HypePlaylistCard } from "./HypePlaylistCard";
import { PredictedSetlistRow } from "./PredictedSetlistRow";
import { EncoreDivider } from "./EncoreDivider";
import { DiscoveredRail } from "./DiscoveredRail";
import {
  RotatingSetlistView,
  RotatingGateBlocked,
} from "./RotatingSetlistView";
import type {
  PredictedSetlistResult,
  RotatingPrediction,
  SongBadge,
  SongBadgesMap,
} from "@showbook/api";
import "./show-tabs.css";

const SPOILER_KEY_PREFIX = "showbook:setlist-tab:spoiler-shown:";

export interface SetlistTabBadgePayload {
  badges: SongBadgesMap;
  /** Lowercase-title → songId map for resolving badges to titles. */
  titleToSongId: Record<string, string>;
}

interface SetlistTabProps {
  showId: string;
  isPast: boolean;
  artistName: string;
  /** Predicted-setlist tRPC response. Null while loading. */
  prediction: PredictedSetlistResult | RotatingPrediction | null;
  /** When true, the predicted-setlist query is in-flight. */
  predictionLoading: boolean;
  /** Actual setlist (post-show). Each entry is `{ title, isEncore }`. */
  actualSongs?: ActualSong[];
  /** Phase 2 — song-badge data for the actual setlist's rows. The
   *  Predicted tab (pre-show) doesn't render badges, since the songs
   *  haven't been played yet. */
  badgePayload?: SetlistTabBadgePayload | null;
  onOpenSpoilerSettings?: () => void;
  /**
   * Phase 3 — when true, render the real Spotify-backed `HypePlaylistCard`
   * in the top slot; otherwise fall back to the P1 placeholder. The
   * `SetlistIntelHypePlaylist` flag gates this; the page level resolves
   * the flag and passes it down.
   */
  hypePlaylistEnabled?: boolean;
  /**
   * Phase 5 — when true, the rotating-style display variant renders for
   * `prediction.style === 'rotating'` payloads. Resolved at the page
   * level from `SetlistIntelRotatingDisplay` && release-gate verdict.
   */
  rotatingDisplayEnabled?: boolean;
  /**
   * Phase 5 — when true, the rotating-display flag is wired ON but the
   * calibration release-gate hasn't cleared, so the rotating subtree
   * is replaced with the labeled placeholder ("model not calibrated").
   */
  rotatingGateBlocked?: boolean;
  /**
   * Phase 7 — when true, mount the DiscoveredRail (past variant)
   * beneath the actual setlist. Gated by `SetlistIntelMusicLayerV2`
   * + admin email bypass; resolved at the page level.
   */
  musicLayerV2Enabled?: boolean;
}

/** Resolve a row's title to (songId, badge) for the past variant. */
function resolveBadge(
  title: string,
  payload: SetlistTabBadgePayload | null | undefined,
): { songId: string | null; badge: SongBadge | undefined } {
  if (!payload) return { songId: null, badge: undefined };
  const songId = payload.titleToSongId[title.toLowerCase()] ?? null;
  const badge = songId ? payload.badges[songId] : undefined;
  return { songId, badge };
}

export interface ActualSong {
  title: string;
  sectionIndex: number;
  songIndex: number;
  isEncore: boolean;
  isOpenerOrCloser?: boolean;
  note?: string | null;
}

export function SetlistTab(props: SetlistTabProps) {
  if (props.isPast) {
    return <SetlistTabPast {...props} />;
  }
  return <SetlistTabUpcoming {...props} />;
}

// ─────────────────────────────────────────────────────────────────────
// Upcoming variant
// ─────────────────────────────────────────────────────────────────────

function SetlistTabUpcoming(props: SetlistTabProps) {
  const {
    prediction,
    predictionLoading,
    artistName,
    hypePlaylistEnabled,
    rotatingDisplayEnabled,
    rotatingGateBlocked,
  } = props;
  const [spoilerShown, setSpoilerShown] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(`${SPOILER_KEY_PREFIX}${props.showId}`) === "1";
    } catch {
      return false;
    }
  });
  const reveal = useCallback(() => {
    setSpoilerShown(true);
    try {
      localStorage.setItem(`${SPOILER_KEY_PREFIX}${props.showId}`, "1");
    } catch {
      // localStorage can be blocked (private mode / SSR): the curtain
      // simply re-shows next visit, which is benign.
    }
  }, [props.showId]);

  if (predictionLoading) {
    return <SetlistTabLoadingState data-state="loading" />;
  }
  if (!prediction) {
    return <SetlistTabColdState reason="no_corpus" artistName={artistName} />;
  }
  if (prediction.style === "cold") {
    return (
      <SetlistTabColdState
        reason={prediction.reason}
        artistName={prediction.performerName ?? artistName}
      />
    );
  }
  if (prediction.style === "rotating") {
    // Per SI-05: HypePlaylistCard is hidden for rotating performers —
    // a 25-song hype playlist is low-relevance when the model can't
    // pick the next 25 songs confidently.
    if (!rotatingDisplayEnabled || rotatingGateBlocked) {
      return <RotatingGateBlocked />;
    }
    return <RotatingSetlistView prediction={prediction} />;
  }

  const core = prediction.core;
  const encore = core.filter(
    (s) => s.role === "encore_open" || s.role === "encore_close",
  );
  const mainSet = core.filter(
    (s) => s.role !== "encore_open" && s.role !== "encore_close",
  );
  const totalCount = mainSet.length + encore.length;
  const approxMinutes = totalCount > 0 ? Math.round(totalCount * 4) : null;

  return (
    <div>
      <ConfidenceBanner
        confidence={prediction.confidence}
        sampleSize={prediction.sampleSize}
        tourName={prediction.tourName}
      />

      <SectionFrame title="Hype playlist">
        {hypePlaylistEnabled ? (
          <HypePlaylistCard
            showId={props.showId}
            kind="hype"
            artist={artistName}
            trackCount={totalCount}
            approxMinutes={approxMinutes}
          />
        ) : (
          <HypePlaylistCardPlaceholder
            artist={prediction.tourName ?? artistName}
            trackCount={totalCount}
            approxMinutes={approxMinutes}
          />
        )}
      </SectionFrame>

      {!spoilerShown && prediction.spoilerBlurDefault ? (
        <SpoilerCurtain
          artistName={artistName}
          onReveal={reveal}
          onOpenSettings={() => props.onOpenSpoilerSettings?.()}
        />
      ) : (
        <SectionFrame
          title="Likely setlist"
          count={totalCount}
        >
          <div className="predicted-grid" data-testid="predicted-setlist-grid">
            {mainSet.map((song, idx) => (
              <PredictedSetlistRow
                key={`main-${idx}-${song.title}`}
                position={idx + 1}
                title={song.title}
                evidence={song.evidence}
                role={song.role}
              />
            ))}
            {encore.length > 0 && (
              <>
                <EncoreDivider />
                {encore.map((song, idx) => (
                  <PredictedSetlistRow
                    key={`encore-${idx}-${song.title}`}
                    position={idx + 1}
                    title={song.title}
                    evidence={song.evidence}
                    role={song.role}
                  />
                ))}
              </>
            )}
          </div>
          {totalCount === 0 && <ThinPredictionEmpty />}
        </SectionFrame>
      )}

      <div
        style={{
          padding: "14px var(--page-pad-x) 24px",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--faint)",
          letterSpacing: ".02em",
          lineHeight: 1.6,
        }}
      >
        Setlist locks in after the show. We&rsquo;ll auto-pull the actual
        songs from setlist.fm and offer a &ldquo;save tonight to Spotify
        &rdquo; button.
      </div>
    </div>
  );
}

function ConfidenceBanner({
  confidence,
  sampleSize,
  tourName,
}: {
  confidence: number;
  sampleSize: number;
  tourName: string | null;
}) {
  const pct = Math.round(confidence * 100);
  return (
    <div className="setlist-banner" data-testid="setlist-confidence-banner">
      <div className="setlist-banner__lead">
        <div className="setlist-banner__number setlist-banner__number--accent">
          {pct}
          <span className="setlist-banner__pct">%</span>
        </div>
        <div className="setlist-banner__label-block">
          <div className="setlist-banner__small-label">Confidence</div>
          <div className="setlist-banner__small-value">STABLE archetype</div>
        </div>
      </div>
      <div className="setlist-banner__source">
        <div className="setlist-banner__source-label">Predicted from</div>
        <div className="setlist-banner__source-line">
          {tourName ? `${tourName} · ` : ""}
          {sampleSize} setlists in our corpus
        </div>
        <div className="setlist-banner__source-sub">
          We use setlist.fm + your attended shows · model recalibrates each
          night
        </div>
      </div>
    </div>
  );
}

function ThinPredictionEmpty() {
  return (
    <div
      style={{
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: "var(--muted)",
        letterSpacing: ".02em",
        lineHeight: 1.6,
      }}
    >
      Not enough confidence in the predicted set to surface specific
      songs yet — we&rsquo;ll backfill as more recent setlists land.
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cold + loading variants
// ─────────────────────────────────────────────────────────────────────

function SetlistTabColdState({
  reason,
  artistName,
}: {
  reason: string;
  artistName: string;
}) {
  const copy = coldReasonCopy(reason, artistName);
  return (
    <div
      data-testid={`setlist-tab-cold-${reason}`}
      style={{
        padding: "48px var(--page-pad-x)",
        textAlign: "center",
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 18,
          fontWeight: 600,
          color: "var(--ink)",
        }}
      >
        {copy.title}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 12,
          letterSpacing: ".02em",
          maxWidth: 460,
          marginInline: "auto",
          lineHeight: 1.6,
        }}
      >
        {copy.body}
      </div>
    </div>
  );
}

function SetlistTabLoadingState(props: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      data-testid="setlist-tab-loading"
      style={{
        padding: "32px var(--page-pad-x)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={{
            height: 36,
            background: "var(--surface)",
            border: "1px solid var(--rule)",
          }}
        />
      ))}
    </div>
  );
}

function coldReasonCopy(
  reason: string,
  artistName: string,
): { title: string; body: string } {
  switch (reason) {
    case "no_mbid":
      return {
        title: "We can't pull recent setlists for this performer",
        body: `${artistName} isn't in the MusicBrainz database we use as the ID source. We'll keep trying to match on the nightly enrichment pass — the prediction will populate automatically once we find them.`,
      };
    case "no_corpus":
      return {
        title: "We're pulling recent setlists",
        body: `Hang tight while we fetch ${artistName}'s recent shows from setlist.fm. Check back in a few hours.`,
      };
    case "date_not_set":
      return {
        title: "Pick a night",
        body: "Once you commit to a date for this run, we'll show the predicted setlist for that specific night.",
      };
    case "wrong_kind":
      return {
        title: "Predicted setlists are for concerts + festivals",
        body: "Comedy, theatre, sports, and film shows don't have rotating setlist semantics — we skip the prediction for these.",
      };
    case "production_show":
      return {
        title: "Production show — no rotating setlist",
        body: "Theatre and festival production runs follow a script rather than a setlist. The Setlist tab is for performer-anchored predictions.",
      };
    case "no_headliner":
      return {
        title: "No headliner on this show",
        body: "We can't predict a setlist without a headliner performer. Try adding one from the Edit show panel.",
      };
    default:
      return {
        title: "Not enough data yet",
        body: "The prediction will populate once we have a recent setlist for this artist.",
      };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Past variant — actual setlist
// ─────────────────────────────────────────────────────────────────────

function SetlistTabPast({
  artistName,
  actualSongs = [],
  hypePlaylistEnabled,
  musicLayerV2Enabled,
  showId,
  badgePayload,
}: SetlistTabProps) {
  const mainSet = actualSongs.filter((s) => !s.isEncore);
  const encore = actualSongs.filter((s) => s.isEncore);
  const total = actualSongs.length;
  const approxMinutes = total > 0 ? Math.round(total * 4) : null;
  if (total === 0) {
    return (
      <div
        data-testid="setlist-tab-past-empty"
        style={{
          padding: "48px var(--page-pad-x)",
          textAlign: "center",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 18,
            fontWeight: 600,
            color: "var(--ink)",
          }}
        >
          Setlist not in yet
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--muted)",
            marginTop: 12,
            letterSpacing: ".02em",
            maxWidth: 460,
            marginInline: "auto",
            lineHeight: 1.6,
          }}
        >
          We&rsquo;ll auto-import {artistName}&rsquo;s setlist from
          setlist.fm during the next nightly run. You can also paste it in
          manually from the Edit panel.
        </div>
      </div>
    );
  }
  return (
    <div>
      <ActualBanner total={total} />
      {hypePlaylistEnabled && (
        <SectionFrame title={`I Heard ${artistName}`}>
          <HypePlaylistCard
            showId={showId}
            kind="heard"
            artist={artistName}
            trackCount={total}
            approxMinutes={approxMinutes}
          />
        </SectionFrame>
      )}
      {musicLayerV2Enabled && <DiscoveredRail showId={showId} />}
      <SectionFrame title="Setlist" count={total}>
        <div className="predicted-grid" data-testid="actual-setlist-grid">
          {mainSet.map((song, idx) => {
            const resolved = resolveBadge(song.title, badgePayload);
            return (
              <PredictedSetlistRow
                key={`main-${idx}-${song.title}`}
                position={idx + 1}
                title={song.title}
                evidence={song.note ?? "actual · setlist.fm"}
                role={
                  song.isOpenerOrCloser
                    ? idx === 0
                      ? "opener"
                      : "closer"
                    : "core"
                }
                badge={resolved.badge}
                songId={resolved.songId}
              />
            );
          })}
          {encore.length > 0 && (
            <>
              <EncoreDivider />
              {encore.map((song, idx) => {
                const resolved = resolveBadge(song.title, badgePayload);
                return (
                  <PredictedSetlistRow
                    key={`encore-${idx}-${song.title}`}
                    position={idx + 1}
                    title={song.title}
                    evidence={song.note ?? "actual · encore"}
                    role={
                      idx === 0
                        ? "encore_open"
                        : idx === encore.length - 1
                          ? "encore_close"
                          : "core"
                    }
                    badge={resolved.badge}
                    songId={resolved.songId}
                  />
                );
              })}
            </>
          )}
        </div>
      </SectionFrame>
    </div>
  );
}

function ActualBanner({ total }: { total: number }) {
  return (
    <div
      className="setlist-banner"
      data-testid="setlist-actual-banner"
    >
      <div className="setlist-banner__lead">
        <div className="setlist-banner__number setlist-banner__number--ink">
          {total}
        </div>
        <div className="setlist-banner__label-block">
          <div className="setlist-banner__small-label">Songs played</div>
          <div
            className="setlist-banner__small-value"
            style={{ color: "var(--accent)" }}
          >
            CONFIRMED
          </div>
        </div>
      </div>
      <div className="setlist-banner__source">
        <div className="setlist-banner__source-label">Source of truth</div>
        <div className="setlist-banner__source-line">
          setlist.fm + your edits
        </div>
        <div className="setlist-banner__source-sub">
          You can amend the setlist any time from the Edit show panel
        </div>
      </div>
    </div>
  );
}

/**
 * Phase-1 "coming soon" placeholder when the prediction style is not
 * `stable`. Phase 5 fills this in with the rotating-style display.
 */
export function SetlistTabComingSoon({ style }: { style: string }) {
  return (
    <div
      data-testid="setlist-tab-coming-soon"
      style={{
        padding: "48px var(--page-pad-x)",
        textAlign: "center",
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 18,
          fontWeight: 600,
          color: "var(--ink)",
        }}
      >
        {style === "rotating"
          ? "Rotating-style display coming in Phase 5"
          : "Predicted-setlist display coming soon"}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 12,
          letterSpacing: ".02em",
          maxWidth: 460,
          marginInline: "auto",
          lineHeight: 1.6,
        }}
      >
        Phase 1 ships the stable-style prediction (Tate McRae, Sabrina,
        major pop tours). The rotating/theatrical/improvised variants
        land in Phase 5+ — until then we hold the slot.
      </div>
    </div>
  );
}

// Re-export for the page-level useEffect.
export { SetlistTabLoadingState };
