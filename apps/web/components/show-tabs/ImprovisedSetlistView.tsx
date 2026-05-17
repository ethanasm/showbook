"use client";

/**
 * Improvised-style predicted-setlist subtree. Phase 6 of setlist-
 * intelligence (§15d improvised + §15p display variants). Mounts
 * inside the Setlist tab when `prediction.style === 'improvised'`
 * AND the `SetlistIntelImprovisedDisplay` feature flag is ON.
 *
 * The model **refuses** song-by-song prediction. The display replaces
 * the likely-setlist section with:
 *
 *   - A "no song-by-song prediction tonight" copy block.
 *   - VibeSketchCard — the show-level 7-axis VibeRadar populated with
 *     sketch data (energy curve buckets, novelty, etc.) and the
 *     "spacier than usual" deltas.
 *   - ShowModeOddsCard — Regular / Marathon / Microtonal split with
 *     per-mode probability bars.
 *   - HypePlaylistCard is HIDDEN at the parent level — same SI-05
 *     reason as rotating: the model can't pick 25 specific songs.
 */

import type { ImprovisedPrediction, VibeAxis } from "@showbook/api";

// Order matches `VIBE_AXIS_ORDER` in
// `packages/api/src/setlist-predict-improvised.ts`. Re-stating the
// list here keeps this component a type-only consumer of
// `@showbook/api` — pulling the runtime constant in would drag the
// tRPC server bundle through the client component graph.
const VIBE_AXIS_ORDER: VibeAxis[] = [
  "energy",
  "danceability",
  "jamLength",
  "novelty",
  "heaviness",
  "psychedelia",
  "tempo",
];

interface ImprovisedSetlistViewProps {
  prediction: ImprovisedPrediction;
}

export function ImprovisedSetlistView({
  prediction,
}: ImprovisedSetlistViewProps) {
  return (
    <div data-testid="improvised-setlist-view">
      <ConfidenceBanner prediction={prediction} />
      <NoSongByPredictionCopy copy={prediction.copy} />
      <VibeSketchCard sketch={prediction.vibeSketch} />
      <ShowModeOddsCard modes={prediction.showModes} />
      <PopularPicksList picks={prediction.vibeSketch.popularPicks} />
    </div>
  );
}

function ConfidenceBanner({ prediction }: { prediction: ImprovisedPrediction }) {
  const pct = Math.round(prediction.confidence * 100);
  return (
    <div
      className="setlist-banner"
      data-testid="setlist-confidence-banner-improvised"
    >
      <div className="setlist-banner__lead">
        <div className="setlist-banner__number setlist-banner__number--accent">
          {pct}
          <span className="setlist-banner__pct">%</span>
        </div>
        <div className="setlist-banner__label-block">
          <div className="setlist-banner__small-label">Confidence</div>
          <div className="setlist-banner__small-value">IMPROVISED archetype</div>
        </div>
      </div>
      <div className="setlist-banner__source">
        <div className="setlist-banner__source-label">Predicted from</div>
        <div className="setlist-banner__source-line">
          {prediction.tourName ? `${prediction.tourName} · ` : ""}
          {prediction.sampleSize} recent setlists
        </div>
        <div className="setlist-banner__source-sub">
          {prediction.vibeSketch.headlineDescriptor}
        </div>
      </div>
    </div>
  );
}

function NoSongByPredictionCopy({ copy }: { copy: string }) {
  return (
    <div
      data-testid="improvised-copy"
      style={{
        padding: "16px var(--page-pad-x) 8px",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11.5,
        color: "var(--muted)",
        letterSpacing: ".02em",
        lineHeight: 1.6,
      }}
    >
      {copy}
    </div>
  );
}

/**
 * VibeSketchCard — predicted show-level vibe shape (energy curve, key
 * counts, "spacier than usual" deltas) at show-level granularity, not
 * per-track. Uses the same 7-axis VibeRadar shape as the design
 * handoff but populated with sketch data rather than per-song actuals.
 *
 * The radar viz is a simple polygon-on-grid SVG — same chrome as
 * Phase 8 will use; lifted here so the improvised display ships
 * without the Spotify audio-features dependency.
 */
export function VibeSketchCard({
  sketch,
}: {
  sketch: ImprovisedPrediction["vibeSketch"];
}) {
  return (
    <div
      data-testid="vibe-sketch-card"
      style={{
        padding: "16px var(--page-pad-x)",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--accent)",
          letterSpacing: ".14em",
          textTransform: "uppercase",
        }}
      >
        Vibe sketch
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 20,
          alignItems: "center",
        }}
      >
        <VibeRadarPolygon axes={sketch.axes} size={160} />
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 14,
              color: "var(--ink)",
              fontWeight: 500,
            }}
          >
            {sketch.headlineDescriptor}
          </div>
          {sketch.deltas.length > 0 && (
            <div
              data-testid="vibe-sketch-deltas"
              style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}
            >
              {sketch.deltas.map((d) => (
                <span
                  key={d.axis}
                  data-axis={d.axis}
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 10.5,
                    color: "var(--accent)",
                    border: "1px solid var(--accent)",
                    padding: "1px 6px",
                    letterSpacing: ".04em",
                  }}
                >
                  {d.description}
                </span>
              ))}
            </div>
          )}
          {sketch.knownTendencies.length > 0 && (
            <ul
              data-testid="vibe-sketch-tendencies"
              style={{
                margin: "6px 0 0",
                paddingLeft: 18,
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--muted)",
                lineHeight: 1.55,
              }}
            >
              {sketch.knownTendencies.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function VibeRadarPolygon({
  axes,
  size,
}: {
  axes: Record<VibeAxis, number>;
  size: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size - 24) / 2;
  const n = VIBE_AXIS_ORDER.length;
  const points = VIBE_AXIS_ORDER.map((axis, i) => {
    const value = axes[axis] ?? 0;
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius * value;
    const y = cy + Math.sin(angle) * radius * value;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  // Background grid: concentric polygons at 0.25 / 0.5 / 0.75 / 1.0.
  const gridPolys = [0.25, 0.5, 0.75, 1].map((ring) => {
    const pts = VIBE_AXIS_ORDER.map((_, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const x = cx + Math.cos(angle) * radius * ring;
      const y = cy + Math.sin(angle) * radius * ring;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return { ring, pts };
  });
  return (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label="Vibe sketch radar"
      data-testid="vibe-radar-polygon"
    >
      {gridPolys.map((g) => (
        <polygon
          key={g.ring}
          points={g.pts}
          fill="none"
          stroke="var(--rule)"
          strokeWidth={1}
        />
      ))}
      <polygon
        points={points}
        fill="var(--accent)"
        fillOpacity={0.18}
        stroke="var(--accent)"
        strokeWidth={1.5}
      />
    </svg>
  );
}

/**
 * ShowModeOddsCard — list of likely "modes" (King Gizzard:
 * "Microtonal night 45% / Thrash night 25% / Mixed 30%") with percent
 * bars. Reused from the design handoff atom name; the rotating
 * variant in Phase 5 used `setCountPrediction` instead, so this is
 * the first concrete instance.
 */
export function ShowModeOddsCard({
  modes,
}: {
  modes: ImprovisedPrediction["showModes"];
}) {
  if (modes.length === 0) return null;
  return (
    <div
      data-testid="show-mode-odds-card"
      style={{
        padding: "16px var(--page-pad-x)",
        borderBottom: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--accent)",
          letterSpacing: ".14em",
          textTransform: "uppercase",
        }}
      >
        Tonight&rsquo;s shape
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {modes.map((mode) => {
          const pct = Math.round(mode.probability * 100);
          return (
            <div
              key={mode.label}
              data-testid="show-mode-row"
              data-mode={mode.label}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 1fr 60px auto",
                columnGap: 12,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 13,
                  color: "var(--ink)",
                }}
              >
                {mode.label}
              </span>
              <div
                aria-hidden="true"
                style={{ background: "var(--rule)", height: 6, position: "relative" }}
              >
                <div
                  style={{
                    background: "var(--accent)",
                    height: 6,
                    width: `${pct}%`,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  color: "var(--muted)",
                  fontFeatureSettings: '"tnum"',
                }}
              >
                {pct}%
              </span>
              <span
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10.5,
                  color: "var(--faint)",
                  whiteSpace: "nowrap",
                }}
              >
                ~{mode.expectedSongCount} songs
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PopularPicksList({
  picks,
}: {
  picks: ImprovisedPrediction["vibeSketch"]["popularPicks"];
}) {
  if (picks.length === 0) return null;
  return (
    <div
      data-testid="popular-picks-list"
      style={{
        padding: "16px var(--page-pad-x)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--accent)",
          letterSpacing: ".14em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Popular picks
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {picks.map((p) => (
          <div
            key={p.title}
            data-testid="popular-pick-row"
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              columnGap: 10,
              padding: "4px 0",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                color: "var(--ink)",
              }}
            >
              {p.title}
            </span>
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              {Math.round(p.playedShare * 100)}% of recent
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Fallback shown when the improvised display would be served but the
 * `SetlistIntelImprovisedDisplay` flag is OFF (or the release-gate
 * hasn't cleared the show-mode calibration threshold yet).
 */
export function ImprovisedGateBlocked() {
  return (
    <div
      data-testid="improvised-gate-blocked"
      style={{
        padding: "32px var(--page-pad-x)",
        textAlign: "center",
        background: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 16,
          fontWeight: 600,
          color: "var(--ink)",
        }}
      >
        Improvised-style display temporarily disabled
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          marginTop: 10,
          letterSpacing: ".02em",
          maxWidth: 460,
          marginInline: "auto",
          lineHeight: 1.6,
        }}
      >
        The vibe sketch isn&rsquo;t calibrated yet — the show-mode
        calibration check needs to clear before the display flips on.
        See{" "}
        <a
          href="/admin/eval"
          style={{ color: "var(--ink)", textDecoration: "underline" }}
        >
          /admin/eval
        </a>
        .
      </div>
    </div>
  );
}
