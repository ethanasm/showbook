/**
 * OverviewTab (mobile) — stat row · lineup · actions, plus an
 * optional music-layer slot for the FanLoyaltyRing (Phase 7).
 * Mirror of the web `OverviewTab`.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { Button, RemoteImage } from '../design-system';
import { SectionFrame } from './SectionFrame';

export interface OverviewStatCell {
  label: string;
  value: string;
  sub?: string;
  onPress?: () => void;
}

export interface OverviewLineupEntry {
  performerId: string;
  name: string;
  role: string;
  characterName?: string | null;
  imageUrl?: string | null;
}

export interface OverviewAction {
  label: string;
  testID?: string;
  onPress?: () => void;
  href?: string;
  primary?: boolean;
  danger?: boolean;
  icon?: React.ReactNode;
}

export interface OverviewTabProps {
  cells: OverviewStatCell[];
  lineup: OverviewLineupEntry[];
  /**
   * Header for the performers section. Theatre shows label it "Cast";
   * everything else uses the default "Lineup".
   */
  lineupLabel?: string;
  actions: OverviewAction[];
  musicLayerSlot?: React.ReactNode;
  /**
   * Tablet-only inline venue mini-map (VenueMapCard). Phone leaves it
   * null — the Map tab is one tap away and vertical space is scarcer.
   */
  venueMapSlot?: React.ReactNode;
  isPast: boolean;
  onOpenPerformer?: (performerId: string) => void;
}

export function OverviewTab({
  cells,
  lineup,
  lineupLabel = 'Lineup',
  actions,
  musicLayerSlot,
  venueMapSlot,
  isPast,
  onOpenPerformer,
}: OverviewTabProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View testID="show-tab-overview">
      <View style={styles.statRow}>
        {cells.map((cell, idx) => {
          const cellStyle = [
            styles.statCell,
            {
              borderRightWidth:
                idx === cells.length - 1 ? 0 : StyleSheet.hairlineWidth,
              borderRightColor: colors.rule,
              borderBottomColor: colors.rule,
            },
          ];
          const content = (
            <>
              <Text style={[styles.statLabel, { color: colors.faint }]}>
                {cell.label}
              </Text>
              <Text
                style={[styles.statValue, { color: colors.ink }]}
                numberOfLines={1}
              >
                {cell.value}
              </Text>
              {cell.sub ? (
                <Text
                  style={[styles.statSub, { color: colors.muted }]}
                  numberOfLines={1}
                >
                  {cell.sub}
                </Text>
              ) : null}
            </>
          );
          if (cell.onPress) {
            return (
              <Pressable
                key={cell.label}
                onPress={cell.onPress}
                accessibilityRole="link"
                accessibilityLabel={`${cell.label} ${cell.value}`}
                style={({ pressed }) => [
                  ...cellStyle,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {content}
              </Pressable>
            );
          }
          return (
            <View key={cell.label} style={cellStyle}>
              {content}
            </View>
          );
        })}
      </View>

      {musicLayerSlot ? (
        <SectionFrame title={isPast ? 'Show shape' : 'Music layer'}>
          {musicLayerSlot}
        </SectionFrame>
      ) : null}

      <SectionFrame title={lineupLabel} count={lineup.length}>
        <View style={styles.lineupCol}>
          {lineup.map((entry) => (
            <Pressable
              key={entry.performerId}
              onPress={() => onOpenPerformer?.(entry.performerId)}
              accessibilityRole="button"
              accessibilityLabel={entry.name}
              style={({ pressed }) => [
                styles.lineupRow,
                {
                  backgroundColor: colors.surface,
                  borderLeftColor: colors.accent,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <RemoteImage
                uri={entry.imageUrl ?? null}
                name={entry.name}
                kind="concert"
                size="custom"
                width={44}
                height={44}
                style={styles.lineupAvatar}
              />
              <View style={styles.lineupText}>
                <Text style={[styles.lineupRole, { color: colors.faint }]}>
                  {entry.role.toUpperCase()}
                </Text>
                <Text style={[styles.lineupName, { color: colors.ink }]} numberOfLines={1}>
                  {entry.name}
                </Text>
                {entry.characterName ? (
                  <Text style={[styles.lineupChar, { color: colors.muted }]}>
                    as {entry.characterName}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
          {lineup.length === 0 ? (
            <Text style={[styles.lineupEmpty, { color: colors.muted }]}>
              No performers listed yet.
            </Text>
          ) : null}
        </View>
      </SectionFrame>

      {venueMapSlot}

      <SectionFrame title="Actions">
        <View style={styles.actionRow}>
          {actions.map((action) => (
            <Button
              key={action.label}
              label={action.label}
              onPress={action.onPress ?? (() => undefined)}
              variant={action.primary ? 'primary' : 'ghost'}
              danger={action.danger ?? false}
              leftIcon={action.icon}
              size="md"
              testID={action.testID}
            />
          ))}
        </View>
      </SectionFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  statCell: {
    flexGrow: 1,
    flexBasis: '50%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  statLabel: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  statValue: {
    fontFamily: 'Geist Sans 600',
    fontSize: 17,
    letterSpacing: -0.4,
  },
  statSub: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.3,
  },
  lineupCol: {
    gap: 8,
  },
  lineupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 2,
    borderRadius: RADII.lg,
  },
  lineupAvatar: {
    borderRadius: RADII.pill,
  },
  lineupText: {
    flex: 1,
    minWidth: 0,
  },
  lineupRole: {
    fontFamily: 'Geist Mono',
    fontSize: 9.5,
    letterSpacing: 1.2,
  },
  lineupName: {
    fontFamily: 'Geist Sans 600',
    fontSize: 18,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  lineupChar: {
    fontFamily: 'Geist Mono',
    fontSize: 10.5,
    letterSpacing: 0.3,
    marginTop: 4,
  },
  lineupEmpty: {
    fontFamily: 'Geist Mono',
    fontSize: 11,
    letterSpacing: 0.3,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});
