/**
 * VenueCard — list-row component for venues.
 *
 * Wide 56×44 photo (or placeholder), venue name, "city · state" line,
 * and a chevron. Stays in step with `ArtistCard` row metrics so mixed
 * lists in Discover and Search render evenly.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { useAuth } from '../lib/auth';
import { venueImageSource } from '../lib/images';
import { RemoteImage } from './design-system/RemoteImage';
import { formatVenueLocation } from '@showbook/shared';

export interface VenueCardVenue {
  id: string;
  name: string;
  city?: string | null;
  stateRegion?: string | null;
  photoUrl?: string | null;
  googlePlaceId?: string | null;
  showCount?: number | null;
  isFollowed?: boolean | null;
}

export interface VenueCardProps {
  venue: VenueCardVenue;
  onPress?: () => void;
}

export function VenueCard({ venue, onPress }: VenueCardProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { token } = useAuth();
  const source = venueImageSource(venue, token);

  const location = formatVenueLocation(venue);
  const subtitleParts: string[] = [];
  if (location) subtitleParts.push(location);
  if (venue.showCount && venue.showCount > 0) {
    subtitleParts.push(`${venue.showCount} show${venue.showCount === 1 ? '' : 's'}`);
  }
  if (venue.isFollowed) subtitleParts.push('Following');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: colors.surface, borderRadius: tokens.radii.lg },
        pressed && styles.pressed,
      ]}
    >
      <RemoteImage
        uri={source?.uri}
        headers={source?.headers}
        name={venue.name}
        kind="concert"
        size="custom"
        width={56}
        height={44}
        style={styles.photo}
      />

      <View style={styles.content}>
        <Text
          style={[styles.name, { color: colors.ink }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {venue.name}
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
  photo: {
    borderRadius: 6,
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
