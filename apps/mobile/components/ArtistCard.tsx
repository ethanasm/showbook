/**
 * ArtistCard — list-row component for performers/artists.
 *
 * Square 44pt avatar (or placeholder initial), headliner name, and a
 * single line of secondary info (show count + last-seen date when
 * available). Mirrors the row metrics of `ShowCard` so artist and
 * show lists look consistent stacked together in the search and
 * discover screens.
 */

import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../lib/theme';

export interface ArtistCardArtist {
  id: string;
  name: string;
  imageUrl?: string | null;
  showCount?: number | null;
  lastSeen?: string | null;
  isFollowed?: boolean | null;
}

export interface ArtistCardProps {
  artist: ArtistCardArtist;
  onPress?: () => void;
}

function formatLastSeen(date: string | null | undefined): string | null {
  if (!date) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = Number(m[2]) - 1;
  return `${months[monthIdx]} ${Number(m[3])}, ${m[1]}`;
}

export function ArtistCard({ artist, onPress }: ArtistCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const showCount = artist.showCount ?? 0;
  const lastSeen = formatLastSeen(artist.lastSeen);
  const initial = artist.name.trim()[0]?.toUpperCase() ?? '?';

  const subtitleParts: string[] = [];
  if (showCount > 0) {
    subtitleParts.push(`${showCount} show${showCount === 1 ? '' : 's'}`);
  }
  if (lastSeen) subtitleParts.push(lastSeen);
  if (artist.isFollowed) subtitleParts.push('Following');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.surface, borderRadius: tokens.radii.lg },
        pressed && styles.pressed,
      ]}
    >
      <View
        style={[
          styles.avatar,
          { backgroundColor: colors.surfaceRaised, borderColor: colors.rule },
        ]}
      >
        {artist.imageUrl ? (
          <Image source={{ uri: artist.imageUrl }} style={styles.avatarImage} />
        ) : (
          <Text style={[styles.avatarInitial, { color: colors.muted }]}>{initial}</Text>
        )}
      </View>

      <View style={styles.content}>
        <Text
          style={[styles.name, { color: colors.ink }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {artist.name}
        </Text>
        {subtitleParts.length > 0 ? (
          <Text
            style={[styles.subtitle, { color: colors.muted }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {subtitleParts.join(' · ')}
          </Text>
        ) : null}
      </View>

      <View style={styles.chevron}>
        <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 12,
  },
  pressed: {
    opacity: 0.85,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 44,
    height: 44,
  },
  avatarInitial: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 21,
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 12.5,
    fontWeight: '400',
    lineHeight: 17,
  },
  chevron: {
    paddingLeft: 4,
  },
});
