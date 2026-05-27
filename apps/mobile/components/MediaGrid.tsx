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
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { summarizeShowCapacity } from '@/lib/media';

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

  // Gate the "Add photos" / "Add more" CTAs against the per-show
  // count caps. Only queried when `canUpload` is true so non-past
  // shows don't fire a wasted lookup. `keepPreviousData` keeps the
  // CTA stable while a refetch is in flight after delete / upload.
  const quota = trpc.media.getQuota.useQuery(
    { showId },
    { enabled: canUpload && Boolean(showId), staleTime: 5_000 },
  );
  const capacity = summarizeShowCapacity(quota.data);
  const atCap = canUpload && capacity.atCap;
  // Per-cap explanatory text when EITHER count is exhausted (used for
  // a "Photos full · 30/30" subtitle even when videos still have
  // room — the picker UX clarifies which medium is gated).
  const capDetail = (() => {
    if (!quota.data) return null;
    const photoFull = capacity.photosRemaining === 0;
    const videoFull = capacity.videosRemaining === 0;
    if (photoFull && videoFull) {
      return `${capacity.photoUsed}/${capacity.photoLimit} photos · ${capacity.videoUsed}/${capacity.videoLimit} videos`;
    }
    if (photoFull) {
      return `${capacity.photoUsed}/${capacity.photoLimit} photos`;
    }
    if (videoFull) {
      return `${capacity.videoUsed}/${capacity.videoLimit} videos`;
    }
    return null;
  })();

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
    // Note: with items.length===0, atCap would mean the quota's
    // showPhotos hit the cap without any READY rows — i.e. a pile of
    // `pending` zombie rows is holding the slot. Treat that the same
    // as the items>0 path so the user gets a clear reason instead of
    // a CTA that disappears mysteriously.
    const ctaLabel = atCap ? 'Photo limit reached' : 'Add photos';
    return (
      <View
        style={[styles.placeholderCard, { backgroundColor: colors.surface, borderColor: colors.rule }]}
      >
        <EmptyState
          icon={<ImageIcon size={32} color={colors.faint} strokeWidth={1.5} />}
          title={canUpload ? 'No photos yet' : 'Photos arrive after the show'}
          subtitle={
            canUpload
              ? atCap && capDetail
                ? `This show is at the per-show limit — ${capDetail}. Remove media to make room.`
                : 'Add up to 12 photos or videos from your night out.'
              : 'You can attach media once the show date passes.'
          }
          cta={
            canUpload && !atCap
              ? {
                  label: ctaLabel,
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
                // The lightbox needs the showId to fetch sibling media
                // via `media.listForShow`. Without it the query stays
                // disabled and the screen renders "Media not found"
                // even when the asset exists. Always include the
                // showId since MediaGrid already has it as a prop.
                else router.push(`/media/${item.id}?showId=${encodeURIComponent(showId)}`);
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
        atCap ? (
          // At per-show cap → render an inert "limit reached" row in
          // place of the add CTA. Visually disabled, no press handler,
          // labels which cap is full so the user knows what to clear.
          <View
            accessibilityRole="text"
            accessibilityLabel={`Photo limit reached. ${capDetail ?? ''}`}
            style={[
              styles.addRow,
              styles.addRowDisabled,
              { borderColor: colors.rule, backgroundColor: colors.surface },
            ]}
          >
            <Text style={[styles.addRowText, { color: colors.faint }]}>
              Photo limit reached
              {capDetail ? ` · ${capDetail}` : ''}
            </Text>
          </View>
        ) : (
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
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeholderCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
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
    fontFamily: 'Geist Sans 600',
    fontSize: 13,
  },
  addRowDisabled: {
    // Distinguishable-but-quiet treatment for the at-cap state. We
    // don't use `opacity: 0.5` because the explanatory text (`Photo
    // limit reached · 30/30 photos`) should still be readable.
  },
});
