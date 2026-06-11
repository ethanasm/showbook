/**
 * VenueMapCard (tablet) — inline venue mini-map on the show detail
 * Overview tab. Carries forward the map context that the retired
 * three-pane shell used to provide as a dedicated third column: a
 * non-interactive snapshot centered on the show's venue, with the
 * whole card tappable to jump to the full Map tab focused on that
 * venue (`/(tabs)/map?focusVenueId=`).
 *
 * Renders nothing when the venue has no coordinates (free-text /
 * Gmail-imported venues the geocode backfill hasn't reached yet) —
 * an empty grey rectangle would be worse than no card.
 *
 * The MapView is wrapped in `pointerEvents="none"` so pans/zooms fall
 * through to the card Pressable; provider + style selection mirrors
 * the Map tab (Google + custom JSON style on Android, Apple default
 * on iOS). On the Expo Web verification bundle the react-native-maps
 * shim renders a labelled placeholder box, which keeps the card's
 * layout and tap-through testable headlessly.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MapPin } from 'lucide-react-native';
import MapView, {
  Marker,
  PROVIDER_DEFAULT,
  PROVIDER_GOOGLE,
} from 'react-native-maps';

import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { SectionFrame } from './SectionFrame';
import darkStyle from '../../app/(tabs)/map-style-dark.json';
import lightStyle from '../../app/(tabs)/map-style-light.json';

export interface VenueMapCardVenue {
  id: string;
  name: string;
  city: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
}

export interface VenueMapCardProps {
  venue: VenueMapCardVenue;
}

const MAP_HEIGHT = 160;
// Tight neighbourhood framing — enough to recognise the area without
// pretending to be a navigable map.
const REGION_DELTA = 0.02;

function toCoord(value: number | string | null): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function VenueMapCard({
  venue,
}: VenueMapCardProps): React.JSX.Element | null {
  const { tokens, mode } = useTheme();
  const { colors } = tokens;
  const router = useRouter();

  const latitude = toCoord(venue.latitude);
  const longitude = toCoord(venue.longitude);
  if (latitude === null || longitude === null) return null;

  return (
    <SectionFrame title="On the map">
      <Pressable
        onPress={() => router.push(`/(tabs)/map?focusVenueId=${venue.id}`)}
        accessibilityRole="button"
        accessibilityLabel={`Show ${venue.name} on the map`}
        testID="venue-map-card"
        style={({ pressed }) => [
          styles.card,
          { borderColor: colors.rule },
          pressed && { opacity: 0.85 },
        ]}
      >
        <View pointerEvents="none" style={styles.map}>
          <MapView
            style={StyleSheet.absoluteFill}
            provider={
              Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT
            }
            initialRegion={{
              latitude,
              longitude,
              latitudeDelta: REGION_DELTA,
              longitudeDelta: REGION_DELTA,
            }}
            // Snapshot, not a map: every gesture and chrome affordance off.
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            showsCompass={false}
            toolbarEnabled={false}
            // Apple Maps silently ignores customMapStyle, so only pass it
            // on Android (Google Maps) where it actually applies.
            {...(Platform.OS === 'android'
              ? { customMapStyle: mode === 'dark' ? darkStyle : lightStyle }
              : null)}
          >
            <Marker coordinate={{ latitude, longitude }} />
          </MapView>
        </View>
        <View
          style={[
            styles.footer,
            { backgroundColor: colors.surface, borderTopColor: colors.rule },
          ]}
        >
          <MapPin size={14} color={colors.accent} strokeWidth={2} />
          <Text
            style={[styles.footerName, { color: colors.ink }]}
            numberOfLines={1}
          >
            {venue.name}
            {venue.city ? (
              <Text style={{ color: colors.muted }}> · {venue.city}</Text>
            ) : null}
          </Text>
          <Text style={[styles.footerCta, { color: colors.muted }]}>
            OPEN MAP
          </Text>
        </View>
      </Pressable>
    </SectionFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADII.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  map: {
    height: MAP_HEIGHT,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerName: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
  },
  footerCta: {
    fontFamily: 'Geist Mono',
    fontSize: 10,
    letterSpacing: 1.2,
  },
});
