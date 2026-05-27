/**
 * CalendarGrid — hand-rolled month view used by the Shows tab.
 *
 * Pure presentational: receives a year/month cursor, a map of YYYY-MM-DD →
 * single-day events (dots), an optional list of multi-day spans (bars
 * drawn across the days a festival or theatre run covers), and a today
 * ISO. Emits taps on day cells. No vendor calendar lib — keeps
 * dependencies tight and matches the design's minimal grid (1px rule
 * borders, kind-colored dots / bars, "today" highlighted with surface
 * tint and bold day number).
 *
 * Also exports `MiniMonth` — a compact 7-col grid used to render each
 * month in the Shows tab's year view, with a single event dot per day
 * and a thin spanning rail under each week row for multi-day events.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme, type Kind } from '../lib/theme';
import { RADII } from '../lib/theme-utils';

export interface CalendarEvent {
  kind: Kind;
  state: 'past' | 'ticketed' | 'watching';
}

export interface CalendarSpan {
  /** Stable key (typically the show id). */
  id: string;
  /** First day inclusive — YYYY-MM-DD. */
  startISO: string;
  /** Last day inclusive — YYYY-MM-DD; must be > startISO for the span
   *  to render as a bar. */
  endISO: string;
  kind: Kind;
  state: 'past' | 'ticketed' | 'watching';
}

export interface CalendarGridProps {
  /** 4-digit year of the displayed month. */
  year: number;
  /** 0-indexed month (Jan = 0). */
  month: number;
  /** Map of `YYYY-MM-DD` → single-day events on that day. Spanning
   *  events should NOT be repeated here per-day — pass them via
   *  `spans` so they render as continuous bars. */
  events: Record<string, CalendarEvent[]>;
  /** Multi-day events that should render as a horizontal bar spanning
   *  the days they cover (clipped to the visible month, wrapping at
   *  week boundaries). */
  spans?: CalendarSpan[];
  /** ISO date (YYYY-MM-DD) of "today" — highlighted in the grid. */
  todayISO: string;
  /** ISO date of the currently selected day (if any). */
  selectedISO?: string | null;
  onSelectDay?: (iso: string) => void;
}

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const MAX_DOTS = 3;
const DAY_MS = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoFor(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

interface WeekSpanSegment {
  span: CalendarSpan;
  /** 0-6 within the week row. */
  startCol: number;
  /** 0-6 within the week row (inclusive). */
  endCol: number;
  /** True iff the bar continues from the previous week (round the left
   *  side off). */
  continuesLeft: boolean;
  /** True iff the bar continues into the next week. */
  continuesRight: boolean;
}

/**
 * Compute, per visible week row, which span events appear and over which
 * column indices. The grid above is laid out as a single flat 6×7 cell
 * array with one cell per render iteration, so each week's segments are
 * stacked under that week's day numbers via absolute positioning.
 */
function buildWeekSegments(
  year: number,
  month: number,
  cells: (number | null)[],
  spans: CalendarSpan[],
): WeekSpanSegment[][] {
  const weekCount = cells.length / 7;
  const result: WeekSpanSegment[][] = Array.from({ length: weekCount }, () => []);
  if (spans.length === 0) return result;

  for (let w = 0; w < weekCount; w += 1) {
    const row = cells.slice(w * 7, w * 7 + 7);
    // First / last calendar day in this week (skipping blanks at row start/end).
    let firstDay: number | null = null;
    let lastDay: number | null = null;
    let firstCol = 0;
    for (let c = 0; c < 7; c += 1) {
      if (row[c] !== null) {
        firstDay = row[c] as number;
        firstCol = c;
        break;
      }
    }
    for (let c = 6; c >= 0; c -= 1) {
      if (row[c] !== null) {
        lastDay = row[c] as number;
        break;
      }
    }
    if (firstDay === null || lastDay === null) continue;

    const weekStartIso = isoFor(year, month, firstDay);
    const weekEndIso = isoFor(year, month, lastDay);
    const weekStart = parseISO(weekStartIso).getTime();
    const weekEnd = parseISO(weekEndIso).getTime();

    for (const span of spans) {
      const sMs = parseISO(span.startISO).getTime();
      const eMs = parseISO(span.endISO).getTime();
      if (eMs < weekStart || sMs > weekEnd) continue;
      const clippedStart = Math.max(sMs, weekStart);
      const clippedEnd = Math.min(eMs, weekEnd);
      const startCol = firstCol + Math.round((clippedStart - weekStart) / DAY_MS);
      const endCol = firstCol + Math.round((clippedEnd - weekStart) / DAY_MS);
      result[w]!.push({
        span,
        startCol,
        endCol,
        continuesLeft: sMs < weekStart,
        continuesRight: eMs > weekEnd,
      });
    }
  }
  return result;
}

export function CalendarGrid({
  year,
  month,
  events,
  spans,
  todayISO,
  selectedISO,
  onSelectDay,
}: CalendarGridProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const firstDow = new Date(year, month, 1).getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysIn; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const weekCount = cells.length / 7;
  const weekSegments = React.useMemo(
    () => buildWeekSegments(year, month, cells, spans ?? []),
    // cells is rebuilt every render but only depends on year/month, so its
    // identity changes don't matter — list the inputs that actually drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year, month, spans],
  );

  return (
    <View style={[styles.container, { borderColor: colors.rule, backgroundColor: colors.surface }]}>
      <View style={[styles.dowRow, { borderBottomColor: colors.rule }]}>
        {DOW_LABELS.map((d, i) => (
          <View key={i} style={styles.dowCell}>
            <Text style={[styles.dowText, { color: colors.faint }]}>{d}</Text>
          </View>
        ))}
      </View>
      <View>
        {Array.from({ length: weekCount }, (_, w) => {
          const rowCells = cells.slice(w * 7, w * 7 + 7);
          const isLastRow = w === weekCount - 1;
          const segments = weekSegments[w] ?? [];
          return (
            <View key={w} style={styles.weekRow}>
              {rowCells.map((day, c) => {
                const cellIdx = w * 7 + c;
                const iso = day ? isoFor(year, month, day) : null;
                const dayEvents = iso ? events[iso] ?? [] : [];
                const isToday = iso === todayISO;
                const isSelected = iso !== null && iso === selectedISO;
                const isLastCol = c === 6;

                return (
                  <Pressable
                    key={cellIdx}
                    disabled={!day}
                    onPress={day && iso ? () => onSelectDay?.(iso) : undefined}
                    accessibilityRole={day ? 'button' : undefined}
                    accessibilityLabel={day ? `${iso}` : undefined}
                    accessibilityState={{ selected: isSelected }}
                    style={[
                      styles.cell,
                      {
                        borderRightWidth: isLastCol ? 0 : StyleSheet.hairlineWidth,
                        borderBottomWidth: isLastRow ? 0 : StyleSheet.hairlineWidth,
                        borderColor: colors.rule,
                        backgroundColor: isSelected
                          ? colors.surfaceRaised
                          : isToday
                            ? colors.surfaceRaised
                            : 'transparent',
                        opacity: day ? 1 : 0.4,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: isToday ? colors.ink : day ? colors.muted : colors.faint,
                          fontWeight: isToday ? '700' : '400',
                        },
                      ]}
                    >
                      {day ?? ''}
                    </Text>
                    {dayEvents.length > 0 && (
                      <View style={styles.dotRow}>
                        {dayEvents.slice(0, MAX_DOTS).map((ev, j) => (
                          <View
                            key={j}
                            style={[
                              styles.dot,
                              {
                                backgroundColor:
                                  ev.state === 'past'
                                    ? tokens.kindColor(ev.kind)
                                    : ev.state === 'ticketed'
                                      ? colors.accent
                                      : tokens.kindColor(ev.kind),
                                opacity: ev.state === 'watching' ? 0.45 : 1,
                              },
                            ]}
                          />
                        ))}
                        {dayEvents.length > MAX_DOTS && (
                          <Text style={[styles.moreText, { color: colors.faint }]}>
                            +{dayEvents.length - MAX_DOTS}
                          </Text>
                        )}
                      </View>
                    )}
                  </Pressable>
                );
              })}
              {/* Spanning bars for multi-day events. Stacked under the day
                  number with a small offset so a one-week festival doesn't
                  hide single-day dots. */}
              {segments.map((seg, idx) => {
                const widthPct = ((seg.endCol - seg.startCol + 1) * 100) / 7;
                const leftPct = (seg.startCol * 100) / 7;
                const bg =
                  seg.span.state === 'past'
                    ? tokens.kindColor(seg.span.kind)
                    : seg.span.state === 'ticketed'
                      ? colors.accent
                      : tokens.kindColor(seg.span.kind);
                const opacity = seg.span.state === 'watching' ? 0.5 : 1;
                return (
                  <View
                    key={`${seg.span.id}:${idx}`}
                    pointerEvents="none"
                    style={[
                      styles.spanBar,
                      {
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        top: 28 + idx * 8,
                        backgroundColor: bg,
                        opacity,
                        borderTopLeftRadius: seg.continuesLeft ? 0 : 3,
                        borderBottomLeftRadius: seg.continuesLeft ? 0 : 3,
                        borderTopRightRadius: seg.continuesRight ? 0 : 3,
                        borderBottomRightRadius: seg.continuesRight ? 0 : 3,
                        marginLeft: seg.continuesLeft ? 0 : 4,
                        marginRight: seg.continuesRight ? 0 : 4,
                      },
                    ]}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
    overflow: 'hidden',
  },
  dowRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dowCell: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  dowText: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  weekRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  cell: {
    width: `${100 / 7}%`,
    minHeight: 64,
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 6,
  },
  dayNum: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    lineHeight: 16,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: RADII.pill,
  },
  moreText: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '500',
  },
  spanBar: {
    position: 'absolute',
    height: 6,
  },
});

// ---------------------------------------------------------------------------
// MiniMonth — used by the Shows tab's year view.
// ---------------------------------------------------------------------------

const MONTH_LABEL = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export interface MiniMonthProps {
  year: number;
  /** 0-indexed month (Jan = 0). */
  month: number;
  events: Record<string, CalendarEvent[]>;
  spans?: CalendarSpan[];
  todayISO: string;
  onPress?: () => void;
  /** When true, the tile is rendered dimmed and not pressable. */
  disabled?: boolean;
}

export function MiniMonth({
  year,
  month,
  events,
  spans,
  todayISO,
  onPress,
  disabled = false,
}: MiniMonthProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const firstDow = new Date(year, month, 1).getDay();
  const daysIn = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i += 1) cells.push(null);
  for (let d = 1; d <= daysIn; d += 1) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Roll spans up so they contribute to the per-month event count and let
  // the year tile show "this month has a festival" even when the festival
  // never has a single-day entry of its own.
  let eventCount = 0;
  for (let d = 1; d <= daysIn; d += 1) {
    const iso = isoFor(year, month, d);
    eventCount += events[iso]?.length ?? 0;
  }
  const spansForMonth = (spans ?? []).filter((s) => {
    const sMs = parseISO(s.startISO).getTime();
    const eMs = parseISO(s.endISO).getTime();
    const monthStart = new Date(year, month, 1).getTime();
    const monthEnd = new Date(year, month + 1, 0).getTime();
    return !(eMs < monthStart || sMs > monthEnd);
  });
  eventCount += spansForMonth.length;

  const isCurrentMonth =
    todayISO.startsWith(`${year}-${month < 9 ? `0${month + 1}` : month + 1}-`);

  const weekCount = cells.length / 7;
  const weekSegments = React.useMemo(
    () => buildWeekSegments(year, month, cells, spansForMonth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [year, month, spansForMonth.length, spans],
  );

  const Wrapper = onPress && !disabled ? Pressable : View;
  return (
    <Wrapper
      {...(onPress && !disabled
        ? {
            onPress,
            accessibilityRole: 'button' as const,
            accessibilityLabel: `${MONTH_LABEL[month]} ${year}, ${eventCount} ${
              eventCount === 1 ? 'show' : 'shows'
            }`,
          }
        : {})}
      style={[
        miniStyles.tile,
        {
          backgroundColor: colors.surface,
          borderColor: isCurrentMonth ? colors.ink : colors.rule,
          borderWidth: isCurrentMonth ? 1 : StyleSheet.hairlineWidth,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text style={[miniStyles.monthLabel, { color: colors.ink }]}>
        {MONTH_LABEL[month]}
      </Text>
      <View>
        {Array.from({ length: weekCount }, (_, w) => {
          const rowCells = cells.slice(w * 7, w * 7 + 7);
          const segments = weekSegments[w] ?? [];
          return (
            <View key={w} style={miniStyles.weekRow}>
              {rowCells.map((day, c) => {
                const iso = day ? isoFor(year, month, day) : null;
                const dayEvents = iso ? events[iso] ?? [] : [];
                const isToday = iso === todayISO;
                const primary = dayEvents[0];
                const dotColor = primary
                  ? primary.state === 'ticketed'
                    ? colors.accent
                    : tokens.kindColor(primary.kind)
                  : null;
                const dotOpacity = primary?.state === 'watching' ? 0.5 : 1;

                return (
                  <View key={c} style={miniStyles.cell}>
                    <Text
                      style={[
                        miniStyles.dayNum,
                        {
                          color: isToday
                            ? colors.ink
                            : day
                              ? colors.muted
                              : 'transparent',
                          fontWeight: isToday ? '700' : '400',
                        },
                      ]}
                    >
                      {day ?? ''}
                    </Text>
                    <View style={miniStyles.dotSlot}>
                      {dotColor && (
                        <View
                          style={[
                            miniStyles.dot,
                            { backgroundColor: dotColor, opacity: dotOpacity },
                          ]}
                        />
                      )}
                    </View>
                  </View>
                );
              })}
              {segments.map((seg, idx) => {
                const widthPct = ((seg.endCol - seg.startCol + 1) * 100) / 7;
                const leftPct = (seg.startCol * 100) / 7;
                const bg =
                  seg.span.state === 'past'
                    ? tokens.kindColor(seg.span.kind)
                    : seg.span.state === 'ticketed'
                      ? colors.accent
                      : tokens.kindColor(seg.span.kind);
                const opacity = seg.span.state === 'watching' ? 0.5 : 1;
                return (
                  <View
                    key={`${seg.span.id}:${idx}`}
                    pointerEvents="none"
                    style={[
                      miniStyles.spanBar,
                      {
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        bottom: idx * 3,
                        backgroundColor: bg,
                        opacity,
                        borderTopLeftRadius: seg.continuesLeft ? 0 : 1.5,
                        borderBottomLeftRadius: seg.continuesLeft ? 0 : 1.5,
                        borderTopRightRadius: seg.continuesRight ? 0 : 1.5,
                        borderBottomRightRadius: seg.continuesRight ? 0 : 1.5,
                      },
                    ]}
                  />
                );
              })}
            </View>
          );
        })}
      </View>
    </Wrapper>
  );
}

const miniStyles = StyleSheet.create({
  tile: {
    borderRadius: RADII.md,
    padding: 8,
    gap: 6,
  },
  monthLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  weekRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  cell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 1,
  },
  dayNum: {
    fontFamily: 'Geist Sans',
    fontSize: 8.5,
    lineHeight: 10,
  },
  dotSlot: {
    height: 5,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 4.5,
    height: 4.5,
    borderRadius: RADII.pill,
  },
  spanBar: {
    position: 'absolute',
    height: 2,
  },
});
