"use client";

import { PredictedSetlistRow } from "./PredictedSetlistRow";
import "./show-tabs.css";

interface RailSong {
  title: string;
  evidence: string;
  role: "opener" | "closer" | "encore_open" | "encore_close" | "core";
  badge: {
    firstTime: boolean;
    rareCatch: { fractionPct: number } | null;
    saved?: boolean;
    personalFirstTime?: boolean;
    topTrack?: boolean;
  };
}

interface SongsYoudWantToHearRailProps {
  /** Filtered subset of `core ∪ likely` predicted songs that carry at
   *  least one personal-weight chip (💛 saved, 🎯 first-time, or
   *  ⭐ top-track). Caller is responsible for the filter. */
  songs: ReadonlyArray<RailSong>;
}

const MIN_SONGS = 3;

/**
 * Phase 11 §15j — "songs you'd want to hear" rail below the main
 * predicted setlist. Hidden when fewer than 3 songs match so the
 * section never feels lonely. The rail shares PredictedSetlistRow so
 * the chip rendering matches the parent list exactly.
 */
export function SongsYoudWantToHearRail({
  songs,
}: SongsYoudWantToHearRailProps) {
  if (songs.length < MIN_SONGS) return null;
  return (
    <section
      className="songs-youd-want-to-hear"
      data-testid="songs-youd-want-to-hear"
    >
      <h3 className="songs-youd-want-to-hear__title">
        Songs you’d want to hear
      </h3>
      {songs.map((s, i) => (
        <PredictedSetlistRow
          key={`youd-want-${s.title}-${i}`}
          position={i + 1}
          title={s.title}
          evidence={s.evidence}
          role={s.role}
          badge={s.badge}
          showPreviewSlot={false}
        />
      ))}
    </section>
  );
}
