"use client";

/**
 * Theatrical-style predicted-setlist subtree. Phase 6 of setlist-
 * intelligence (§15c theatrical + §15p display variants). Mounts
 * inside the Setlist tab when `prediction.style === 'theatrical'`.
 *
 * Top to bottom (matches the worked example in
 * `docs/specs/setlist-intelligence/worked-examples.md` §3 +
 * `phase-06-theatrical-improvised.md`):
 *
 *   - Confidence banner (THEATRICAL archetype label)
 *   - HypePlaylistCard (rendered by the parent — theatrical KEEPS the
 *     hype playlist since the deterministic setlist is hype-worthy
 *     and ordering-stable)
 *   - Copy line — "Tonight's show is choreographed top to bottom..."
 *   - Per-act program — fixed rows under each ActDivider; rotating
 *     slots render inline as RotatingSlotCards in the same flow as
 *     fixed rows so the reader's eye sees them in show order.
 */

import type { TheatricalPrediction } from "@showbook/api";

interface TheatricalSetlistViewProps {
  prediction: TheatricalPrediction;
}

export function TheatricalSetlistView({ prediction }: TheatricalSetlistViewProps) {
  // Group rows + rotating slots by act for the program layout. Each
  // act's items are ordered by deterministic-position when we have it
  // (deterministic rows come ordered already; slots carry positionInAct).
  const grouped = groupByAct(prediction);
  return (
    <div data-testid="theatrical-setlist-view">
      <ConfidenceBanner prediction={prediction} />
      <CopyBlock copy={prediction.copy} />
      <div data-testid="theatrical-program">
        {grouped.map((group) => (
          <div key={group.actLabel}>
            <ActDivider label={group.actLabel} />
            {group.entries.map((entry, idx) =>
              entry.kind === "fixed" ? (
                <TheatricalRow
                  key={`fixed-${group.actLabel}-${idx}-${entry.row.title}`}
                  position={entry.position}
                  title={entry.row.title}
                  slotShare={entry.row.slotShare}
                />
              ) : (
                <RotatingSlotCard
                  key={`rotating-${group.actLabel}-${idx}`}
                  slot={entry.slot}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface GroupedAct {
  actLabel: string;
  entries: Array<
    | { kind: "fixed"; row: TheatricalPrediction["deterministicSetlist"][number]; position: number }
    | { kind: "rotating"; slot: TheatricalPrediction["rotatingSlots"][number] }
  >;
}

function groupByAct(prediction: TheatricalPrediction): GroupedAct[] {
  // Preserve the natural act ordering by walking the deterministic
  // setlist first (it's already sorted by actIndex / position) and
  // splicing rotating slots into the act they belong to.
  const acts = new Map<string, GroupedAct>();
  const actOrder: string[] = [];
  let positionCounter = new Map<string, number>();
  for (const row of prediction.deterministicSetlist) {
    let group = acts.get(row.act);
    if (!group) {
      group = { actLabel: row.act, entries: [] };
      acts.set(row.act, group);
      actOrder.push(row.act);
    }
    const pos = (positionCounter.get(row.act) ?? 0) + 1;
    positionCounter.set(row.act, pos);
    group.entries.push({ kind: "fixed", row, position: pos });
  }
  for (const slot of prediction.rotatingSlots) {
    let group = acts.get(slot.act);
    if (!group) {
      group = { actLabel: slot.act, entries: [] };
      acts.set(slot.act, group);
      actOrder.push(slot.act);
    }
    group.entries.push({ kind: "rotating", slot });
  }
  return actOrder.map((label) => acts.get(label)!);
}

function ConfidenceBanner({ prediction }: { prediction: TheatricalPrediction }) {
  const pct = Math.round(prediction.confidence * 100);
  return (
    <div
      className="setlist-banner"
      data-testid="setlist-confidence-banner-theatrical"
    >
      <div className="setlist-banner__lead">
        <div className="setlist-banner__number setlist-banner__number--accent">
          {pct}
          <span className="setlist-banner__pct">%</span>
        </div>
        <div className="setlist-banner__label-block">
          <div className="setlist-banner__small-label">Confidence</div>
          <div className="setlist-banner__small-value">THEATRICAL archetype</div>
        </div>
      </div>
      <div className="setlist-banner__source">
        <div className="setlist-banner__source-label">Predicted from</div>
        <div className="setlist-banner__source-line">
          {prediction.tourName ? `${prediction.tourName} · ` : ""}
          {prediction.sampleSize} setlists, {prediction.deterministicSetlist.length}-song program
        </div>
        <div className="setlist-banner__source-sub">
          {prediction.rotatingSlots.length === 0
            ? "Every position is locked night-to-night."
            : `${prediction.rotatingSlots.length} rotating slot${prediction.rotatingSlots.length === 1 ? "" : "s"} vary nightly — surfaced below.`}
        </div>
      </div>
    </div>
  );
}

function CopyBlock({ copy }: { copy: string }) {
  return (
    <div
      data-testid="theatrical-copy"
      style={{
        padding: "14px var(--page-pad-x) 6px",
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
 * ActDivider — same chrome as `EncoreDivider` from Phase 1. Used for
 * Act I, Act II, Encore, etc. The label is centered with mono caps
 * tracking.
 */
export function ActDivider({ label }: { label: string }) {
  return (
    <div
      data-testid="act-divider"
      data-act={label}
      style={{
        padding: "16px var(--page-pad-x) 6px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10,
          color: "var(--accent)",
          letterSpacing: ".18em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        — {label}
      </div>
      <div
        style={{
          flex: 1,
          height: 1,
          background: "var(--rule)",
        }}
        aria-hidden="true"
      />
    </div>
  );
}

function TheatricalRow({
  position,
  title,
  slotShare,
}: {
  position: number;
  title: string;
  slotShare: number;
}) {
  const sharePct = Math.round(slotShare * 100);
  return (
    <div
      data-testid="theatrical-row"
      data-title={title}
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr auto",
        columnGap: 12,
        padding: "10px var(--page-pad-x)",
        borderBottom: "1px solid var(--rule)",
        alignItems: "center",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10.5,
          color: "var(--faint)",
        }}
      >
        {String(position).padStart(2, "0")}
      </span>
      <span
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 14,
          color: "var(--ink)",
        }}
      >
        {title}
      </span>
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {sharePct === 100 ? "every night" : `${sharePct}% of shows`}
      </span>
    </div>
  );
}

/**
 * RotatingSlotCard — the 1-3 song slots that vary night-to-night,
 * shown as a "tonight one of:" picker with per-candidate probability
 * bars. Used inline in the theatrical program flow.
 */
export function RotatingSlotCard({
  slot,
}: {
  slot: TheatricalPrediction["rotatingSlots"][number];
}) {
  return (
    <div
      data-testid="rotating-slot-card"
      data-slot-name={slot.slotName}
      style={{
        padding: "14px var(--page-pad-x)",
        borderBottom: "1px solid var(--rule)",
        background: "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          aria-hidden="true"
          style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 12 }}
        >
          ⭐
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--accent)",
            letterSpacing: ".14em",
            textTransform: "uppercase",
          }}
        >
          {slot.slotName}
        </span>
        <span
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
          }}
        >
          tonight one of:
        </span>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        {slot.candidates.map((c) => (
          <CandidateRow key={c.title} candidate={c} />
        ))}
      </div>
    </div>
  );
}

function CandidateRow({
  candidate,
}: {
  candidate: TheatricalPrediction["rotatingSlots"][number]["candidates"][number];
}) {
  const pct = Math.round(candidate.probability * 100);
  return (
    <div
      data-testid="rotating-slot-candidate"
      data-title={candidate.title}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 50px auto",
        columnGap: 10,
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
        {candidate.title}
      </span>
      <div
        aria-hidden="true"
        style={{
          background: "var(--rule)",
          height: 4,
          position: "relative",
        }}
      >
        <div
          style={{
            background: "var(--accent)",
            height: 4,
            width: `${pct}%`,
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        {pct}%
      </span>
    </div>
  );
}

