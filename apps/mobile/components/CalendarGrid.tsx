/**
 * CalendarGrid — hand-rolled month view used by the Shows tab.
 *
 * Pure presentational: receives a year/month cursor, a map of YYYY-MM-DD →
 * events, and emits taps on day cells. No vendor calendar lib — keeps
 * dependencies tight and matches the design's minimal grid (1px rule
 * borders, kind-colored dots per event, "today" highlighted with surface
 * tint and bold day number).
 *
 * Also exports `MiniMonth` — a compact 7-col grid used to render each
 * month in the Shows tab's year view, with a single event dot per day.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme, type Kind } from '../lib/theme';

export interface CalendarEvent {
  kind: Kind;
  state: 'past' | 'ticketed' | 'watching';
}

export interface CalendarGridProps {
  /** 4-digit year of the displayed month. */
  year: number;
  /** 0-indexed month (Jan = 0). */
  month: number;
  /** Map of `YYYY-MM-DD` → events on that day. */
  events: Record<string, CalendarEvent[]>;
  /** ISO date (YYYY-MM-DD) of "today" — highlighted in the grid. */
  todayISO: string;
  /** ISO date of the currently selected day (if any). */
  selectedISO?: string | null;
  onSelectDay?: (iso: string) => void;
}

const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const MAX_DOTS = 3;

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function isoFor(year: number, month0: number, day: number): string {
  return `${year}-${pad2(month0 + 1)}-${pad2(day)}`;
}

export function CalendarGrid({
  year,
  month,
  events,
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

  return (
    <View style={[styles.container, { borderColor: colors.rule, backgroundColor: colors.surface }]}>
      <View style={[styles.dowRow, { borderBottomColor: colors.rule }]}>
        {DOW_LABELS.map((d, i) => (
          <View key={i} style={styles.dowCell}>
            <Text style={[styles.dowText, { color: colors.faint }]}>{d}</Text>
          </View>
        ))}
      </View>
      <View style={styles.grid}>
        {cells.map((day, i) => {
          const iso = day ? isoFor(year, month, day) : null;
          const dayEvents = iso ? events[iso] ?? [] : [];
          const isToday = iso === todayISO;
          const isSelected = iso !== null && iso === selectedISO;
          const isLastCol = i % 7 === 6;
          const isLastRow = i >= cells.length - 7;

          return (
            <Pressable
              key={i}
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
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    borderRadius: 5,
  },
  moreText: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '500',
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
  todayISO: string;
  onPress?: () => void;
  /** When true, the tile is rendered dimmed and not pressable. */
  disabled?: boolean;
}

export function MiniMonth({
  year,
  month,
  events,
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

  let eventCount = 0;
  for (let d = 1; d <= daysIn; d += 1) {
    const iso = isoFor(year, month, d);
    eventCount += events[iso]?.length ?? 0;
  }

  const isCurrentMonth =
    todayISO.startsWith(`${year}-${month < 9 ? `0${month + 1}` : month + 1}-`);

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
      <View style={miniStyles.grid}>
        {cells.map((day, i) => {
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
            <View key={i} style={miniStyles.cell}>
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
      </View>
    </Wrapper>
  );
}

const miniStyles = StyleSheet.create({
  tile: {
    borderRadius: 8,
    padding: 8,
    gap: 6,
  },
  monthLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    borderRadius: 2.5,
  },
});
