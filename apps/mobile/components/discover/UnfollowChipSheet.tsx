/**
 * Action sheet shown when a Discover filter chip is long-pressed. Offers
 * a destructive "Unfollow / Remove" action scoped to whichever tab the
 * chip belongs to (venue / artist / region), mirroring the web rail's
 * right-click "Unfollow" affordance (`VenueRail` /
 * `discover-venue-group__header` context menu in
 * `apps/web/app/(app)/discover/View.client.tsx`). Venue chips (the
 * Venues tab and the Regions tab's venue sub-rail) additionally get a
 * "Rename venue" action that opens `RenameVenueSheet`.
 *
 * Callback-driven like `UpcomingAnnouncementActionSheet`: the parent
 * owns the optimistic mutation + cache invalidation; this component only
 * renders the menu and dismisses itself before firing.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MapPin, Pencil, Trash2, Users } from 'lucide-react-native';

import { Sheet } from '../Sheet';
import { useTheme } from '@/lib/theme';
import { hapticSelection } from '@/lib/haptics';
import type { AddDiscoverTab } from './AddToDiscoverSheet';

const COPY: Record<
  AddDiscoverTab,
  { action: string; icon: (color: string) => React.ReactNode }
> = {
  venues: {
    action: 'Unfollow venue',
    icon: (color) => <MapPin size={20} color={color} strokeWidth={2} />,
  },
  artists: {
    action: 'Unfollow artist',
    icon: (color) => <Users size={20} color={color} strokeWidth={2} />,
  },
  regions: {
    action: 'Remove region',
    icon: (color) => <Trash2 size={20} color={color} strokeWidth={2} />,
  },
};

export function UnfollowChipSheet({
  open,
  onClose,
  tab,
  name,
  onConfirm,
  canRename = false,
  onRename,
  showUnfollow = true,
}: {
  open: boolean;
  onClose: () => void;
  tab: AddDiscoverTab;
  /** Display name of the chip target, shown in the sheet header. */
  name: string | null;
  onConfirm: () => void;
  /** Venue chips can be renamed (per-user alias via `venues.rename`). */
  canRename?: boolean;
  /** Invoked when the "Rename venue" row is tapped. The sheet dismisses
   *  itself first so the rename sheet animates in cleanly. */
  onRename?: () => void;
  /** Region-scoped venue sub-rail chips aren't followed, so they get no
   *  destructive action — only rename. Defaults to true. */
  showUnfollow?: boolean;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const copy = COPY[tab];

  const handleConfirm = (): void => {
    void hapticSelection();
    onClose();
    onConfirm();
  };

  const handleRename = (): void => {
    void hapticSelection();
    onClose();
    onRename?.();
  };

  // Size the sheet to its row count: one row (~26%), two rows (~32%).
  const rowCount = (canRename ? 1 : 0) + (showUnfollow ? 1 : 0);
  const snap = rowCount >= 2 ? '32%' : '26%';

  return (
    <Sheet open={open} onClose={onClose} snapPoints={[snap]}>
      <View style={styles.body}>
        {name ? (
          <Text style={[styles.title, { color: colors.muted }]} numberOfLines={1}>
            {name}
          </Text>
        ) : null}
        {canRename ? (
          <Pressable
            onPress={handleRename}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.rule },
              pressed && { backgroundColor: colors.surface },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Rename venue"
            testID="discover-chip-rename"
          >
            <View style={styles.iconSlot}>
              <Pencil size={20} color={colors.ink} strokeWidth={2} />
            </View>
            <Text style={[styles.label, { color: colors.ink }]}>Rename venue</Text>
          </Pressable>
        ) : null}
        {showUnfollow ? (
          <Pressable
            onPress={handleConfirm}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: colors.rule },
              pressed && { backgroundColor: colors.surface },
            ]}
            accessibilityRole="button"
            accessibilityLabel={copy.action}
            testID="discover-chip-unfollow"
          >
            <View style={styles.iconSlot}>{copy.icon(colors.danger)}</View>
            <Text style={[styles.label, { color: colors.danger }]}>
              {copy.action}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  title: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconSlot: {
    width: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontFamily: 'Geist Sans 500',
    fontSize: 15,
  },
});
