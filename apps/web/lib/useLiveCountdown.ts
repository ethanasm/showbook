"use client";

import { useEffect, useState } from "react";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TWO_DAYS_MS = 2 * DAY_MS;
// Default assumed doors time when the show row only carries a calendar
// date (today everything is calendar-only — see specs note about
// adding showTime). The mobile + web hero copy already hardcodes
// "doors 7:00 pm", so keeping the anchor consistent here avoids a
// jarring drift between the surrounding copy and the countdown.
const DEFAULT_DOORS_HOUR = 19;

/**
 * Returns a live-ticking countdown label for a calendar-day show date
 * (YYYY-MM-DD) anchored at the local-time doors hour. The hook only
 * re-renders when it actually needs to — once per minute while > 1 h
 * away, once per second under the last hour — so a hero card with
 * five upcoming shows doesn't burn a frame per second on each.
 *
 *   - > 48 h away → calendar label ("in 5 days", "tomorrow", "tonight")
 *   - 1 h–48 h     → "23h 04m"
 *   - < 1 h        → "00:14:09"
 *   - past         → "started"  (the caller can show post-show UI)
 *
 * `fallback` is shown when `dateYmd` is null (e.g. multi-night runs
 * the user hasn't pinned a date for yet) — matches the existing
 * `countdownText(null) === 'date TBD'` contract.
 */
export function useLiveCountdown(
  dateYmd: string | null,
  options?: { doorsHour?: number; fallback?: string },
): string {
  const doorsHour = options?.doorsHour ?? DEFAULT_DOORS_HOUR;
  const fallback = options?.fallback ?? "date TBD";
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!dateYmd) return;
    const target = resolveTargetMs(dateYmd, doorsHour);
    if (target == null) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    function schedule() {
      if (cancelled) return;
      const current = Date.now();
      setNow(current);
      // Schedule the next tick at the cadence appropriate to how close
      // we are to the anchor. Aligning to the next whole second boundary
      // keeps the displayed digits monotone.
      const remaining = target! - current;
      let interval: number;
      if (remaining <= 0) {
        interval = 60_000;
      } else if (remaining < HOUR_MS) {
        interval = 1000 - (current % 1000);
      } else {
        interval = 60_000 - (current % 60_000);
      }
      timeoutId = setTimeout(schedule, interval);
    }
    schedule();

    return () => {
      cancelled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
    };
  }, [dateYmd, doorsHour]);

  if (!dateYmd) return fallback;
  return formatCountdown(dateYmd, doorsHour, now);
}

function resolveTargetMs(dateYmd: string, doorsHour: number): number | null {
  // Local-zone anchor. dateYmd is a calendar date (no zone info), so
  // we deliberately build a local Date — UTC parsing would shift the
  // doors anchor by the user's offset.
  const [y, m, d] = dateYmd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, doorsHour, 0, 0, 0).getTime();
}

/**
 * Pure formatter — exposed for unit testing the cadence transitions
 * without scheduling a real interval.
 */
export function formatCountdown(
  dateYmd: string,
  doorsHour: number,
  nowMs: number,
): string {
  const target = resolveTargetMs(dateYmd, doorsHour);
  if (target == null) return "date TBD";
  const remaining = target - nowMs;

  if (remaining <= 0) {
    // Past the doors anchor. We don't show negative deltas in the live
    // hook — the caller's "past show" UI takes over.
    return "started";
  }

  if (remaining > TWO_DAYS_MS) {
    // Calendar-day text matches the existing `countdownText()` output
    // so the > 48 h branch reads identically to the un-ticked label.
    const days = Math.round(remaining / DAY_MS);
    if (days === 1) return "tomorrow";
    return `in ${days} days`;
  }

  if (remaining >= HOUR_MS) {
    const totalMinutes = Math.floor(remaining / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes - hours * 60;
    return `${hours}h ${pad2(minutes)}m`;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `00:${pad2(minutes)}:${pad2(seconds)}`;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
