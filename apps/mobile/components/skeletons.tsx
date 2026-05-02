/**
 * Reusable skeleton compositions for the common list-row patterns.
 *
 * Builds on the base `Skeleton` primitive. Each variant matches the
 * dimensions of the real component it stands in for, so layout doesn't
 * shift when data arrives.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Skeleton } from './Skeleton';
import { useTheme } from '../lib/theme';

/**
 * ShowCardSkeleton — matches the dimensions of `<ShowCard>`.
 * Date block (44pt) + content column (kind chip + headliner + venue).
 */
export function ShowCardSkeleton(): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View
      style={[
        styles.showCard,
        {
          backgroundColor: tokens.colors.surface,
          borderRadius: tokens.radii.lg,
          borderLeftColor: tokens.colors.rule,
        },
      ]}
    >
      <View style={styles.dateBlock}>
        <Skeleton width={32} height={11} />
        <View style={{ height: 4 }} />
        <Skeleton width={28} height={22} />
        <View style={{ height: 4 }} />
        <Skeleton width={24} height={10} />
      </View>
      <View style={styles.content}>
        <Skeleton width={80} height={16} radius={999} />
        <View style={{ height: 6 }} />
        <Skeleton width="80%" height={16} />
        <View style={{ height: 4 }} />
        <Skeleton width="60%" height={13} />
      </View>
    </View>
  );
}

/**
 * MediaTileSkeleton — square tile placeholder for media grids.
 * Pass `size` to match the grid's tile dimensions.
 */
export function MediaTileSkeleton({ size = 96 }: { size?: number }): React.JSX.Element {
  return <Skeleton width={size} height={size} radius={12} />;
}

/**
 * RowSkeleton — generic single-line list row (avatar/icon + text + meta).
 * Used for Artists, Venues, Search results.
 */
export function RowSkeleton({
  showAvatar = true,
  showMeta = true,
}: {
  showAvatar?: boolean;
  showMeta?: boolean;
}): React.JSX.Element {
  return (
    <View style={styles.row}>
      {showAvatar ? <Skeleton width={32} height={32} radius={6} /> : null}
      <View style={styles.rowContent}>
        <Skeleton width="55%" height={14} />
        <View style={{ height: 4 }} />
        <Skeleton width="35%" height={11} />
      </View>
      {showMeta ? <Skeleton width={56} height={11} /> : null}
    </View>
  );
}

/**
 * ShowCardListSkeleton — N stacked ShowCardSkeletons. Spec: M2 Home/Shows.
 */
export function ShowCardListSkeleton({ count = 5 }: { count?: number }): React.JSX.Element {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }, (_, i) => (
        <ShowCardSkeleton key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  showCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    paddingLeft: 16,
    borderLeftWidth: 3,
  },
  dateBlock: {
    minWidth: 44,
    alignItems: 'center',
  },
  content: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
  },
  list: {
    gap: 8,
    paddingHorizontal: 16,
  },
});
