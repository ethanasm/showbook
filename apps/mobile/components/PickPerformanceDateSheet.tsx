/**
 * Bottom sheet for picking a specific performance date from a multi-night
 * run announcement (e.g. Phantom of the Opera at the Orpheum, May 28 –
 * Jun 24). The Discover row opens this when the user taps "Got ticket"
 * on a run; selecting a date hands the chosen ISO date back to the
 * caller so it can pre-fill the add-show form's date field.
 *
 * Web parity: matches the `PickDateBanner` on the show detail page —
 * mobile just front-loads the choice so the add-form arrives with the
 * right date already filled in, instead of creating a dateless show
 * and asking the user to pick later.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Sheet } from './Sheet';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export interface PickPerformanceDateSheetProps {
  open: boolean;
  onClose: () => void;
  /** Title shown above the date list (typically the show / production name). */
  title: string;
  /** ISO YYYY-MM-DD strings; rendered in chronological order. */
  performanceDates: string[];
  /** Called with the picked date. The sheet closes automatically. */
  onPick: (date: string) => void;
}

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDateRow(iso: string): { dow: string; label: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { dow: '', label: iso };
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const local = new Date(y, mo - 1, d);
  const dow = DOWS[local.getDay()] ?? '';
  const month = MONTHS[mo - 1] ?? '';
  return { dow, label: `${month} ${d}, ${y}` };
}

export function PickPerformanceDateSheet({
  open,
  onClose,
  title,
  performanceDates,
  onPick,
}: PickPerformanceDateSheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const sorted = React.useMemo(() => {
    return [...performanceDates].sort();
  }, [performanceDates]);

  const handlePick = (date: string): void => {
    onPick(date);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} snapPoints={['65%']}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.ink }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[styles.hint, { color: colors.muted }]}>
          Pick the performance you have tickets for.
        </Text>

        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          {sorted.length === 0 ? (
            <Text style={[styles.empty, { color: colors.muted }]}>
              No performance dates available — you can set the date on the next screen.
            </Text>
          ) : (
            sorted.map((date) => {
              const { dow, label } = formatDateRow(date);
              return (
                <Pressable
                  key={date}
                  onPress={() => handlePick(date)}
                  accessibilityRole="button"
                  accessibilityLabel={`Pick ${label}`}
                  testID={`pick-date-${date}`}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      borderColor: colors.rule,
                      backgroundColor: colors.surface,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.rowDow, { color: colors.muted }]}>
                    {dow.toUpperCase()}
                  </Text>
                  <Text style={[styles.rowLabel, { color: colors.ink }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          style={({ pressed }) => [
            styles.cancelBtn,
            { borderColor: colors.ruleStrong },
            pressed && { opacity: 0.7 },
          ]}
        >
          <Text style={[styles.cancelLabel, { color: colors.ink }]}>Cancel</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 16,
    paddingTop: 4,
    flex: 1,
    gap: 10,
  },
  title: {
    fontFamily: 'Geist Sans 600',
    fontSize: 17,
    letterSpacing: -0.2,
  },
  hint: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingBottom: 8,
  },
  empty: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    paddingVertical: 24,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
  },
  rowDow: {
    fontFamily: 'Geist Mono 600',
    fontSize: 10.5,
    letterSpacing: 0.8,
    width: 32,
  },
  rowLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 14.5,
    flex: 1,
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.pill,
    alignSelf: 'center',
    marginTop: 4,
  },
  cancelLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
  },
});
