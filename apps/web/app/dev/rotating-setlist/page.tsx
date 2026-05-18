"use client";

/**
 * Dev-only preview for the Phase-5 rotating-style predicted-setlist
 * subtree. Renders RotatingSetlistView against the Phish worked-
 * example payload from
 * `docs/specs/setlist-intelligence/worked-examples.md` §2 so a
 * reviewer can see the gap chart + position pools + multi-night
 * banner without seeding a rotating-classified performer + a passing
 * release-gate row.
 *
 * Mirrors the `/dev/components` pattern. Public; not behind any flag
 * — the underlying RotatingSetlistView component is gated on the
 * Setlist tab, so leaving the dev preview reachable in prod is safe
 * (no live data, no mutations).
 */

import type { RotatingPrediction } from "@showbook/api";
import { RotatingSetlistView } from "@/components/show-tabs/RotatingSetlistView";

const PHISH_PREDICTION: RotatingPrediction = {
  style: "rotating",
  copy:
    "Phish has played 140+ unique songs across 8 Sphere nights so far. " +
    "Probability of any specific song is low — here's what's overdue.",
  confidence: 0.41,
  sampleSize: 84,
  tourId: "phish__spring-2026-sphere",
  tourName: "Spring Tour 2026 — Sphere Residency",
  due: [
    { title: "Bug", currentGap: 47, meanGap: 12, overdueScore: 3.92, totalPlays: 89, lastPlayedDate: "2025-08-13" },
    { title: "Tweezer Reprise", currentGap: 18, meanGap: 6, overdueScore: 3.0, totalPlays: 460, lastPlayedDate: "2026-04-12" },
    { title: "Run Like an Antelope", currentGap: 24, meanGap: 9, overdueScore: 2.66, totalPlays: 380, lastPlayedDate: "2026-04-05" },
    { title: "Slave to the Traffic Light", currentGap: 31, meanGap: 14, overdueScore: 2.21, totalPlays: 220, lastPlayedDate: "2026-03-29" },
    { title: "David Bowie", currentGap: 28, meanGap: 13, overdueScore: 2.15, totalPlays: 380, lastPlayedDate: "2026-04-01" },
    { title: "Reba", currentGap: 22, meanGap: 11, overdueScore: 2.0, totalPlays: 290, lastPlayedDate: "2026-04-07" },
  ],
  hot: [
    { title: "Evolve", playedCount: 6, playedShare: 0.75, evidence: "6 of last 8" },
    { title: "Sand", playedCount: 4, playedShare: 0.5, evidence: "4 of last 8" },
    { title: "Tweezer", playedCount: 4, playedShare: 0.5, evidence: "4 of last 8 — different jam each time" },
  ],
  bustoutCandidates: [
    {
      title: "McGrupp and the Watchful Hosemasters",
      currentGap: 142,
      meanGap: 38,
      overdueScore: 3.74,
      totalPlays: 18,
      lastPlayedDate: "2024-12-30",
    },
    {
      title: "The Line",
      currentGap: 89,
      meanGap: 65,
      overdueScore: 1.37,
      totalPlays: 9,
      lastPlayedDate: "2025-06-12",
    },
  ],
  positions: [
    {
      role: "opener",
      poolEntropy: 0.78,
      candidates: [
        { title: "Free", slotShare: 0.13, playedThisRun: true },
        { title: "Sample in a Jar", slotShare: 0.12 },
        { title: "AC/DC Bag", slotShare: 0.11 },
        { title: "Llama", slotShare: 0.1 },
        { title: "Suzy Greenberg", slotShare: 0.08, playedThisRun: true },
        { title: "Buried Alive", slotShare: 0.07 },
        { title: "Wilson", slotShare: 0.06 },
        { title: "Cars Trucks Buses", slotShare: 0.05 },
      ],
    },
    {
      role: "closer",
      poolEntropy: 0.62,
      candidates: [
        { title: "Run Like an Antelope", slotShare: 0.19, dueDoubleFlag: true },
        { title: "Harry Hood", slotShare: 0.15 },
        { title: "Slave to the Traffic Light", slotShare: 0.12, dueDoubleFlag: true },
        { title: "Possum", slotShare: 0.1 },
      ],
    },
    {
      role: "encore_open",
      poolEntropy: 0.7,
      candidates: [
        { title: "Loving Cup", slotShare: 0.18 },
        { title: "A Day in the Life", slotShare: 0.14 },
        { title: "Show of Life", slotShare: 0.1 },
      ],
    },
    {
      role: "encore_close",
      poolEntropy: 0.55,
      candidates: [
        { title: "Tweezer Reprise", slotShare: 0.21, dueDoubleFlag: true },
        { title: "First Tube", slotShare: 0.18, playedThisRun: true },
        { title: "Slave to the Traffic Light", slotShare: 0.1, dueDoubleFlag: true },
        { title: "Character Zero", slotShare: 0.08 },
        { title: "Backwards Down the Number Line", slotShare: 0.06 },
      ],
    },
  ],
  multiNightContext: {
    venue: "Sphere at the Venetian Resort",
    runIndex: 9,
    priorNights: 8,
    songsAlreadyPlayed: [
      "Free",
      "Birds of a Feather",
      "Limb By Limb",
      "Mike's Song",
      "Weekapaug Groove",
      "Timber",
      "Cities",
      "Halley's Comet",
      "Chalk Dust Torture",
      "Ghost",
      "First Tube",
      "Suzy Greenberg",
    ],
    runStartDate: "2026-04-16",
  },
  setCountPrediction: {
    setCount: 2,
    setCountConfidence: 0.98,
    expectedSongCount: { p25: 17, p50: 19, p75: 22 },
    expectedDurationMin: 165,
  },
};

export default function RotatingPreviewPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--ink)",
      }}
    >
      <div
        style={{
          padding: "16px var(--page-pad-x, 24px)",
          borderBottom: "1px solid var(--rule)",
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          letterSpacing: ".12em",
          color: "var(--muted)",
          textTransform: "uppercase",
        }}
      >
        Dev preview · Phase 5 rotating-style setlist (Phish · Sphere)
      </div>
      <RotatingSetlistView prediction={PHISH_PREDICTION} />
    </main>
  );
}
