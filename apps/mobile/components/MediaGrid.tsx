/**
 * MediaGrid — three-column grid of `MediaTile`s for ShowDetail's photos
 * section (M4).
 *
 * The grid wraps its own loading + empty states so callers don't have to
 * branch. When there are zero ready assets but the user can upload (i.e.,
 * the show is in the past), an inline "Add photos" CTA replaces the empty
 * state.
 *
 * Layout: three columns with a 6dp gutter, full-bleed within the parent's
 * horizontal padding. Tile size is computed from the available width.
 */

import React, { useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image as ImageIcon, Plus } from 'lucide-react-native';
import { useRouter } from 'expo-router';

import { MediaTile } from './MediaTile';
import { EmptyState } from './EmptyState';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';

export interface MediaGridItem {
  id: string;
  thumbnailUri: string;
  caption: string | null;
  tagCount: number;
}

export interface MediaGridProps {
  items: MediaGridItem[];
  showId: string;
  /** Whether the user can upload to this show (server requires past date). */
  canUpload?: boolean;
  loading?: boolean;
  /** Override navigation for the lightbox tap. Defaults to `/media/[id]`. */
  onItemPress?: (item: MediaGridItem) => void;
  /** Override long-press tag flow. Defaults to `/show/[id]/tag/[mediaId]`. */
  onItemLongPress?: (item: MediaGridItem) => void;
  /** Override "Add photos" tap. Defaults to `/show/[id]/upload`. */
  onAddPress?: () => void;
}

const COLUMNS = 3;
const GUTTER = 6;
const SCREEN_PADDING = 20; // matches ShowDetail's horizontal padding

function computeTileSize(): number {
  const width = Dimensions.get('window').width;
  const usable = width - SCREEN_PADDING * 2 - GUTTER * (COLUMNS - 1);
  return Math.floor(usable / COLUMNS);
}

export function MediaGrid({
  items,
  showId,
  canUpload = true,
  loading = false,
  onItemPress,
  onItemLongPress,
  onAddPress,
}: MediaGridProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();

  const tileSize = useMemo(() => computeTileSize(), []);

  if (loading && items.length === 0) {
    return (
      <View style={[styles.placeholderCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
        <View style={styles.skeletonRow}>
          {[0, 1, 2].map((i) => (
            <View
              key={i}
              style={[
                styles.skeletonTile,
                {
                  width: tileSize,
                  height: tileSize,
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.rule,
                },
              ]}
            />
          ))}
        </View>
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <View
        style={[styles.placeholderCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}
      >
        <EmptyState
          icon={<ImageIcon size={32} color={colors.faint} strokeWidth={1.5} />}
          title={canUpload ? 'No photos yet' : 'Photos arrive after the show'}
          subtitle={
            canUpload
              ? 'Add up to 12 photos or videos from your night out.'
              : 'You can attach media once the show date passes.'
          }
          cta={
            canUpload
              ? {
                  label: 'Add photos',
                  onPress: () => {
                    if (onAddPress) onAddPress();
                    else router.push(`/show/${showId}/upload`);
                  },
                }
              : undefined
          }
        />
      </View>
    );
  }

  return (
    <View>
      <View style={styles.grid}>
        {items.map((item) => (
          <View
            key={item.id}
            style={{ width: tileSize, height: tileSize, marginRight: GUTTER, marginBottom: GUTTER }}
          >
            <MediaTile
              uri={item.thumbnailUri}
              caption={item.caption}
              tagCount={item.tagCount}
              size={tileSize}
              onPress={() => {
                if (onItemPress) onItemPress(item);
                else router.push(`/media/${item.id}`);
              }}
              onLongPress={() => {
                if (onItemLongPress) onItemLongPress(item);
                else router.push(`/show/${showId}/tag/${item.id}`);
              }}
            />
          </View>
        ))}
      </View>

      {canUpload ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add more photos"
          onPress={() => {
            if (onAddPress) onAddPress();
            else router.push(`/show/${showId}/upload`);
          }}
          style={({ pressed }) => [
            styles.addRow,
            { borderColor: colors.rule, backgroundColor: colors.surface },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Plus size={16} color={colors.ink} strokeWidth={2} />
          <Text style={[styles.addRowText, { color: colors.ink }]}>Add more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholderCard: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // The tiles already carry their own marginRight/marginBottom; we
    // negate the trailing gutter on the row so the grid edge lines up.
    marginBottom: -GUTTER,
    marginRight: -GUTTER,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: GUTTER,
    padding: 12,
  },
  skeletonTile: {
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  addRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.md,
  },
  addRowText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '600',
  },
});
