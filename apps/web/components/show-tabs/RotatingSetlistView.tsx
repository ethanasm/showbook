"use client";

/**
 * Rotating-style predicted-setlist subtree. Phase 5 of setlist-
 * intelligence (§15c–15e). Mounts inside the Setlist tab whenever
 * `prediction.style === 'rotating'`.
 *
 * Top to bottom (matches the rotating-style spec in
 * docs/specs/setlist-intelligence/ui-spec.md §4.1):
 *
 *   - Confidence banner (same shell as stable; label "ROTATING")
 *   - MultiNightContextBanner (when same-venue consecutive run detected)
 *   - DUE  → stack of GapChartRows
 *   - HOT  → short list of high-recent-share songs
 *   - BUSTOUT CANDIDATES → BustoutCandidateRows
 *   - POSITION POOLS → opener / closer / encore_open / encore_close
 */

import { useState } from "react";
import type { RotatingPrediction } from "@showbook/api";
import { SectionFrame } from "./SectionFrame";

const ROLE_LABELS: Record<string, string> = {
  opener: "OPENER",
  closer: "CLOSER",
  encore_open: "ENCORE OPEN",
  encore_close: "ENCORE CLOSE",
};

interface RotatingSetlistViewProps {
  prediction: RotatingPrediction;
}

export function RotatingSetlistView({ prediction }: RotatingSetlistViewProps) {
  return (
    <div data-testid="rotating-setlist-view">
      <ConfidenceBanner prediction={prediction} />
      {prediction.multiNightContext && (
        <MultiNightContextBanner context={prediction.multiNightContext} />
      )}
      {prediction.due.length > 0 && (
        <SectionFrame title="Due" count={prediction.due.length}>
          <div data-testid="rotating-due-list">
            {prediction.due.map((song, idx) => (
              <GapChartRow key={`due-${idx}-${song.title}`} song={song} />
            ))}
          </div>
        </SectionFrame>
      )}
      {prediction.hot.length > 0 && (
        <SectionFrame title="Hot" count={prediction.hot.length}>
          <div data-testid="rotating-hot-list">
            {prediction.hot.map((s, idx) => (
              <HotRow
                key={`hot-${idx}-${s.title}`}
                title={s.title}
                evidence={s.evidence}
              />
            ))}
          </div>
        </SectionFrame>
      )}
      {prediction.bustoutCandidates.length > 0 && (
        <SectionFrame
          title="Bustout candidates"
          count={prediction.bustoutCandidates.length}
        >
          <div data-testid="rotating-bustout-list">
            {prediction.bustoutCandidates.map((song, idx) => (
              <BustoutCandidateRow
                key={`bustout-${idx}-${song.title}`}
                song={song}
              />
            ))}
          </div>
        </SectionFrame>
      )}
      {prediction.positions.length > 0 && (
        <SectionFrame title="Position pools">
          <div data-testid="rotating-position-pools">
            {prediction.positions.map((pool) => (
              <PositionPoolCard key={pool.role} pool={pool} />
            ))}
          </div>
        </SectionFrame>
      )}
    </div>
  );
}

function ConfidenceBanner({ prediction }: { prediction: RotatingPrediction }) {
  const pct = Math.round(prediction.confidence * 100);
  return (
    <div className="setlist-banner" data-testid="setlist-confidence-banner-rotating">
      <div className="setlist-banner__lead">
        <div className="setlist-banner__number setlist-banner__number--accent">
          {pct}
          <span className="setlist-banner__pct">%</span>
        </div>
        <div className="setlist-banner__label-block">
          <div className="setlist-banner__small-label">Confidence</div>
          <div className="setlist-banner__small-value">ROTATING archetype</div>
        </div>
      </div>
      <div className="setlist-banner__source">
        <div className="setlist-banner__source-label">Predicted from</div>
        <div className="setlist-banner__source-line">
          {prediction.tourName ? `${prediction.tourName} · ` : ""}
          {prediction.sampleSize} setlists in our corpus
        </div>
        <div className="setlist-banner__source-sub">{prediction.copy}</div>
      </div>
    </div>
  );
}

export function MultiNightContextBanner({
  context,
}: {
  context: NonNullable<RotatingPrediction["multiNightContext"]>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      data-testid="multi-night-context-banner"
      style={{
        padding: "14px var(--page-pad-x)",
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--ink)",
        }}
      >
        Night {context.runIndex} at {context.venue}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: ".02em",
          lineHeight: 1.6,
        }}
      >
        {context.songsAlreadyPlayed.length} songs already played this run —
        they&rsquo;re excluded from tonight&rsquo;s picks.
      </div>
      {context.songsAlreadyPlayed.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="multi-night-toggle"
          style={{
            alignSelf: "flex-start",
            background: "transparent",
            border: "1px solid var(--rule)",
            padding: "4px 10px",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            cursor: "pointer",
          }}
        >
          {expanded ? "Hide list" : "Show all"}
        </button>
      )}
      {expanded && (
        <ul
          data-testid="multi-night-songs-list"
          style={{
            margin: 0,
            paddingLeft: 18,
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          {context.songsAlreadyPlayed.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GapChartRow({
  song,
}: {
  song: RotatingPrediction["due"][number];
}) {
  // Bar width — scaled by overdueScore but capped at 100%.
  const pct = Math.min(100, Math.round((song.overdueScore / 4) * 100));
  return (
    <div
      data-testid="gap-chart-row"
      data-title={song.title}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        columnGap: 10,
        padding: "10px 0",
        borderBottom: "1px solid var(--rule)",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 14,
            color: "var(--ink)",
          }}
        >
          {song.title}
        </div>
        <div
          aria-hidden="true"
          style={{
            background: "var(--rule)",
            height: 6,
            position: "relative",
            width: "100%",
          }}
        >
          <div
            style={{
              background: "var(--accent)",
              height: 6,
              width: `${pct}%`,
            }}
          />
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: ".02em",
          whiteSpace: "nowrap",
        }}
      >
        {song.currentGap}-show gap · avg {song.meanGap.toFixed(0)}
      </div>
    </div>
  );
}

function HotRow({ title, evidence }: { title: string; evidence: string }) {
  return (
    <div
      data-testid="rotating-hot-row"
      style={{
        display: "flex",
        justifyContent: "space-between",
        padding: "8px 0",
        borderBottom: "1px solid var(--rule)",
        fontFamily: "var(--font-geist-sans), sans-serif",
        fontSize: 13,
        color: "var(--ink)",
      }}
    >
      <span>{title}</span>
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {evidence}
      </span>
    </div>
  );
}

export function BustoutCandidateRow({
  song,
}: {
  song: RotatingPrediction["bustoutCandidates"][number];
}) {
  return (
    <div
      data-testid="bustout-candidate-row"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        columnGap: 10,
        padding: "8px 0",
        borderBottom: "1px solid var(--rule)",
        alignItems: "center",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 16 }}>
        ✨
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 14,
            color: "var(--ink)",
          }}
        >
          {song.title}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
          }}
        >
          {song.totalPlays} total plays · long-overdue
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--accent)",
        }}
      >
        ×{song.overdueScore.toFixed(1)}
      </span>
    </div>
  );
}

export function PositionPoolCard({
  pool,
}: {
  pool: RotatingPrediction["positions"][number];
}) {
  return (
    <div
      data-testid="position-pool-card"
      data-role={pool.role}
      style={{
        padding: "12px 0",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--muted)",
            letterSpacing: ".14em",
          }}
        >
          {ROLE_LABELS[pool.role] ?? pool.role.toUpperCase()}
        </div>
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
          }}
        >
          entropy {pool.poolEntropy.toFixed(2)}
        </div>
      </div>
      {pool.candidates.length === 0 ? (
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            color: "var(--faint)",
          }}
        >
          No candidates in corpus yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {pool.candidates.map((c) => (
            <PositionPoolCandidateRow
              key={`${pool.role}-${c.title}`}
              candidate={c}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PositionPoolCandidateRow({
  candidate,
}: {
  candidate: RotatingPrediction["positions"][number]["candidates"][number];
}) {
  const sharePct = Math.round(candidate.slotShare * 100);
  return (
    <div
      data-testid="position-pool-candidate"
      data-played-this-run={candidate.playedThisRun ? "1" : "0"}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto auto",
        columnGap: 10,
        alignItems: "baseline",
        opacity: candidate.playedThisRun ? 0.4 : 1,
        textDecoration: candidate.playedThisRun ? "line-through" : "none",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 13,
          color: "var(--ink)",
        }}
      >
        {candidate.title}
      </span>
      {candidate.dueDoubleFlag && (
        <span
          aria-label="due"
          data-testid="due-double-flag"
          style={{
            padding: "0 6px",
            background: "var(--accent)",
            color: "var(--accent-text)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 9.5,
            letterSpacing: ".08em",
          }}
        >
          ★ DUE
        </span>
      )}
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {sharePct}%
      </span>
    </div>
  );
}
