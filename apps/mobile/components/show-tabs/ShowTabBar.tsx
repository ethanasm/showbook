/**
 * ShowTabBar (mobile) — the sticky 4-tab toggle bar at the top of the
 * show-detail screen. Renders Overview · Setlist · Media · Notes; each
 * label is paired with an optional badge pill (confidence % pre-show,
 * count post-show; photo count; · indicator on Notes).
 *
 * The order is fixed across pre/post show so muscle memory survives.
 * Pulling the bar out of `SegmentedControl` so the per-tab badge can
 * render alongside the label.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import { RADII } from '../../lib/theme-utils';
import {
  SHOW_TAB_KEYS,
  type ShowTabBadges,
  type ShowTabKey,
} from '../../lib/setlist-intel';

const TAB_LABELS: Record<ShowTabKey, string> = {
  overview: 'Overview',
  setlist: 'Setlist',
  media: 'Media',
  notes: 'Notes',
};

export interface ShowTabBarProps {
  active: ShowTabKey;
  badges: ShowTabBadges;
  onSelect: (next: ShowTabKey) => void;
  /** Tabs to omit from the bar (e.g. `setlist` for non-concert shows). */
  hiddenTabs?: readonly ShowTabKey[];
  testID?: string;
}

export function ShowTabBar({
  active,
  badges,
  onSelect,
  hiddenTabs,
  testID,
}: ShowTabBarProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const hidden = new Set(hiddenTabs ?? []);
  const visibleTabs = SHOW_TAB_KEYS.filter((key) => !hidden.has(key));
  return (
    <View
      testID={testID ?? 'show-tab-bar'}
      style={[
        styles.bar,
        { backgroundColor: colors.bg, borderBottomColor: colors.rule },
      ]}
    >
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {visibleTabs.map((key) => {
          const isActive = key === active;
          const badge = badges[key];
          return (
            <Pressable
              key={key}
              onPress={() => onSelect(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={TAB_LABELS[key]}
              testID={`show-tab-${key}`}
              style={[styles.tab, isActive && { borderBottomColor: colors.accent }]}
            >
              <Text
                style={[
                  styles.label,
                  {
                    color: isActive ? colors.ink : colors.muted,
                    fontWeight: isActive ? '600' : '500',
                  },
                ]}
              >
                {TAB_LABELS[key]}
              </Text>
              {badge != null ? (
                <View
                  style={[
                    styles.badge,
                    {
                      backgroundColor: isActive ? colors.accent : colors.rule,
                    },
                  ]}
                  testID={`show-tab-${key}-badge`}
                >
                  <Text
                    style={[
                      styles.badgeText,
                      {
                        color: isActive
                          ? colors.accentText
                          : colors.muted,
                      },
                    ]}
                  >
                    {badge}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scrollContent: {
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    letterSpacing: -0.1,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: RADII.pill,
    minWidth: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
