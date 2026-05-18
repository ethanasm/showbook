/**
 * Live-ticking countdown hook (mobile mirror of `apps/web/lib/useLiveCountdown.ts`).
 *
 * Anchor: local-time doors hour (defaults to 19:00 — matches the
 * hardcoded "doors 7:00 pm" copy in HeroCard / ShowDetail). Cadence:
 * 60 s while > 1 h away, 1 s while < 1 h, falls through to the
 * static "in 5 days" / "tomorrow" / "tonight" label above the 48 h
 * window so distant shows don't re-render every minute.
 *
 * Pure formatter (`formatCountdown`) is exported separately so unit
 * tests can advance "now" without scheduling a real interval.
 */

import { useEffect, useState } from 'react';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const TWO_DAYS_MS = 2 * DAY_MS;
const DEFAULT_DOORS_HOUR = 19;

export function useLiveCountdown(
  dateYmd: string | null,
  options?: { doorsHour?: number; fallback?: string },
): string {
  const doorsHour = options?.doorsHour ?? DEFAULT_DOORS_HOUR;
  const fallback = options?.fallback ?? 'date TBD';
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
  const [y, m, d] = dateYmd.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, doorsHour, 0, 0, 0).getTime();
}

export function formatCountdown(
  dateYmd: string,
  doorsHour: number,
  nowMs: number,
): string {
  const target = resolveTargetMs(dateYmd, doorsHour);
  if (target == null) return 'date TBD';
  const remaining = target - nowMs;

  if (remaining <= 0) return 'started';

  if (remaining > TWO_DAYS_MS) {
    const days = Math.round(remaining / DAY_MS);
    if (days === 1) return 'tomorrow';
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
