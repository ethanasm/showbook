"use client";

import "./show-tabs.css";

interface SetCountStripProps {
  /** Phase 11 §15f — uniform shape produced by all four style
   *  predictors. `null` from the API means the corpus was too thin
   *  (< 3 rows) to estimate; in that case the strip is hidden. */
  prediction:
    | {
        setCount: number;
        setCountConfidence: number;
        expectedSongCount: { p25: number; p50: number; p75: number };
        expectedDurationMin: number | null;
      }
    | null
    | undefined;
}

/**
 * Inline strip rendered above the predicted setlist on every style.
 * Format: "1 SET · ~22 SONGS · ~95 MIN" (omits the minutes segment
 * when the corpus didn't carry duration data).
 */
export function SetCountStrip({ prediction }: SetCountStripProps) {
  if (!prediction) return null;
  const setLabel = prediction.setCount === 1 ? "set" : "sets";
  return (
    <div className="set-count-strip" data-testid="set-count-strip">
      <span className="set-count-strip__primary">
        {prediction.setCount} {setLabel}
      </span>
      <span className="set-count-strip__sep">·</span>
      <span>~{prediction.expectedSongCount.p50} songs</span>
      {prediction.expectedDurationMin ? (
        <>
          <span className="set-count-strip__sep">·</span>
          <span>~{prediction.expectedDurationMin} min</span>
        </>
      ) : null}
    </div>
  );
}
