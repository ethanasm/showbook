/**
 * Map tab — M2.
 *
 * Personal map of every show the signed-in user has logged. Pins are
 * positioned at venue coordinates, bucketed into a grid that re-evaluates
 * as the user pans/zooms, and tapping a pin opens a venue sheet listing
 * every visit at that venue.
 *
 * Data source: trpc.shows.listForMap (already returns the headliner name
 * and venue lat/lng). We do NOT call a region-scoped procedure — the
 * "Search this area" affordance is a pan-detection re-cluster only.
 *
 * Clustering is hand-rolled grid bucketing — no external cluster lib.
 * Cell size scales with the visible longitude delta so clusters break
 * apart smoothly as the user zooms in.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin, Search, X } from 'lucide-react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  PROVIDER_DEFAULT,
  type Region,
} from 'react-native-maps';
import type { Kind } from '@showbook/shared';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { Sheet } from '../../components/Sheet';
import { useTheme } from '../../lib/theme';
import { trpc } from '../../lib/trpc';
import { useAuth } from '../../lib/auth';
import { useCachedQuery } from '../../lib/cache';
import darkStyle from './map-style-dark.json';
import lightStyle from './map-style-light.json';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MapShow = {
  id: string;
  kind: Kind;
  state: string;
  date: string | Date | null;
  seat: string | null;
  pricePaid: string | number | null;
  ticketCount: number | null;
  venue: {
    id: string;
    name: string;
    city: string | null;
    stateRegion: string | null;
    latitude: number | string | null;
    longitude: number | string | null;
    photoUrl: string | null;
  };
  headlinerName: string | null;
  headlinerId: string | null;
  headlinerImageUrl: string | null;
};

interface VenueGroup {
  venueId: string;
  name: string;
  city: string | null;
  stateRegion: string | null;
  lat: number;
  lng: number;
  shows: MapShow[];
}

interface Cluster {
  id: string;
  lat: number;
  lng: number;
  count: number;
  dominantKind: Kind;
  venues: VenueGroup[]; // single-venue cluster ⇒ length 1
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_REGION: Region = {
  latitude: 39.5,
  longitude: -98.35, // continental US center; auto-fit replaces this once data loads
  latitudeDelta: 40,
  longitudeDelta: 50,
};

const KIND_FILTERS: readonly { k: 'all' | Kind; label: string }[] = [
  { k: 'all', label: 'all' },
  { k: 'concert', label: 'concert' },
  { k: 'theatre', label: 'theatre' },
  { k: 'comedy', label: 'comedy' },
  { k: 'festival', label: 'festival' },
  { k: 'sports', label: 'sports' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function groupByVenue(shows: MapShow[]): VenueGroup[] {
  const byId = new Map<string, VenueGroup>();
  for (const show of shows) {
    const lat = toNumber(show.venue.latitude);
    const lng = toNumber(show.venue.longitude);
    if (lat === null || lng === null) continue;
    const existing = byId.get(show.venue.id);
    if (existing) {
      existing.shows.push(show);
    } else {
      byId.set(show.venue.id, {
        venueId: show.venue.id,
        name: show.venue.name,
        city: show.venue.city,
        stateRegion: show.venue.stateRegion,
        lat,
        lng,
        shows: [show],
      });
    }
  }
  return Array.from(byId.values());
}

function dominantKind(shows: MapShow[]): Kind {
  const counts: Partial<Record<Kind, number>> = {};
  for (const s of shows) counts[s.kind] = (counts[s.kind] ?? 0) + 1;
  let best: Kind = 'concert';
  let bestN = -1;
  for (const k of Object.keys(counts) as Kind[]) {
    const n = counts[k] ?? 0;
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/**
 * Grid bucketing. Cell size scales with the current longitude delta so
 * pins cluster at low zoom and split apart at high zoom. Clusters are
 * placed at the centroid of their member venues.
 */
function clusterVenues(venues: VenueGroup[], region: Region): Cluster[] {
  const cellSize = Math.max(region.longitudeDelta / 10, 0.0008);
  const cells = new Map<string, VenueGroup[]>();
  for (const v of venues) {
    const key = `${Math.floor(v.lat / cellSize)}:${Math.floor(v.lng / cellSize)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(v);
    else cells.set(key, [v]);
  }
  const clusters: Cluster[] = [];
  for (const [key, bucket] of cells) {
    let sumLat = 0;
    let sumLng = 0;
    let count = 0;
    const allShows: MapShow[] = [];
    for (const v of bucket) {
      sumLat += v.lat;
      sumLng += v.lng;
      count += v.shows.length;
      for (const s of v.shows) allShows.push(s);
    }
    clusters.push({
      id: bucket.length === 1 ? `v:${bucket[0]!.venueId}` : `c:${key}`,
      lat: sumLat / bucket.length,
      lng: sumLng / bucket.length,
      count,
      dominantKind: dominantKind(allShows),
      venues: bucket,
    });
  }
  return clusters;
}

function fitRegion(venues: VenueGroup[]): Region {
  if (venues.length === 0) return DEFAULT_REGION;
  let minLat = venues[0]!.lat;
  let maxLat = venues[0]!.lat;
  let minLng = venues[0]!.lng;
  let maxLng = venues[0]!.lng;
  for (const v of venues) {
    if (v.lat < minLat) minLat = v.lat;
    if (v.lat > maxLat) maxLat = v.lat;
    if (v.lng < minLng) minLng = v.lng;
    if (v.lng > maxLng) maxLng = v.lng;
  }
  const latDelta = Math.max((maxLat - minLat) * 1.4, 0.05);
  const lngDelta = Math.max((maxLng - minLng) * 1.4, 0.05);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}

/** Crude distance metric in degrees; used to detect "user has panned". */
function regionDelta(a: Region, b: Region): number {
  return (
    Math.abs(a.latitude - b.latitude) +
    Math.abs(a.longitude - b.longitude) +
    Math.abs(a.latitudeDelta - b.latitudeDelta) +
    Math.abs(a.longitudeDelta - b.longitudeDelta)
  );
}

function formatDate(date: string | Date | null): string {
  if (!date) return '';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPrice(value: string | number | null): string | null {
  const n = toNumber(value);
  if (n === null || n <= 0) return null;
  return `$${Math.round(n)}`;
}

function pinRadius(count: number): number {
  return Math.max(8, Math.min(22, 7 + count * 1.4));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapScreen(): React.JSX.Element {
  const { tokens, mode } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const mapRef = React.useRef<MapView>(null);

  const utils = trpc.useUtils();
  const showsQuery = useCachedQuery<MapShow[]>({
    queryKey: ['mobile', 'shows.listForMap'],
    queryFn: () => utils.client.shows.listForMap.query() as Promise<MapShow[]>,
    enabled: Boolean(token),
  });

  const [kindFilter, setKindFilter] = React.useState<'all' | Kind>('all');
  const [region, setRegion] = React.useState<Region>(DEFAULT_REGION);
  const [loadedRegion, setLoadedRegion] = React.useState<Region>(DEFAULT_REGION);
  const [selectedClusterId, setSelectedClusterId] = React.useState<string | null>(null);
  const [didFitOnce, setDidFitOnce] = React.useState(false);

  const allShows = React.useMemo(
    () => (showsQuery.data ?? []) as MapShow[],
    [showsQuery.data],
  );

  const filteredShows = React.useMemo(
    () =>
      kindFilter === 'all' ? allShows : allShows.filter((s) => s.kind === kindFilter),
    [allShows, kindFilter],
  );

  const venues = React.useMemo(() => groupByVenue(filteredShows), [filteredShows]);

  const clusters = React.useMemo(
    () => clusterVenues(venues, region),
    [venues, region],
  );

  // Fit camera to the user's venues once, on first successful load.
  React.useEffect(() => {
    if (didFitOnce) return;
    if (!showsQuery.isSuccess) return;
    const allVenues = groupByVenue(allShows);
    if (allVenues.length === 0) return;
    const fit = fitRegion(allVenues);
    setRegion(fit);
    setLoadedRegion(fit);
    mapRef.current?.animateToRegion(fit, 400);
    setDidFitOnce(true);
  }, [showsQuery.isSuccess, allShows, didFitOnce]);

  const onRegionChangeComplete = React.useCallback((next: Region) => {
    setRegion(next);
  }, []);

  const onMarkerPress = React.useCallback(
    (cluster: Cluster) => {
      if (cluster.venues.length === 1) {
        setSelectedClusterId(cluster.id);
        return;
      }
      // Multi-venue cluster — zoom in toward the cluster center.
      const next: Region = {
        latitude: cluster.lat,
        longitude: cluster.lng,
        latitudeDelta: Math.max(region.latitudeDelta / 2.2, 0.02),
        longitudeDelta: Math.max(region.longitudeDelta / 2.2, 0.02),
      };
      mapRef.current?.animateToRegion(next, 400);
    },
    [region],
  );

  const selectedCluster = React.useMemo(
    () => clusters.find((c) => c.id === selectedClusterId) ?? null,
    [clusters, selectedClusterId],
  );
  const selectedVenue = selectedCluster?.venues[0] ?? null;

  // "Search this area" appears once the user has panned far enough away
  // from the last region we re-clustered against. Tapping it just commits
  // the current region as the new baseline (clusters already update live).
  const panDelta = regionDelta(region, loadedRegion);
  const shouldShowSearchArea =
    didFitOnce &&
    panDelta >
      Math.max(loadedRegion.latitudeDelta, loadedRegion.longitudeDelta) * 0.25;

  const onSearchAreaPress = React.useCallback(() => {
    setLoadedRegion(region);
    void showsQuery.refetch();
  }, [region, showsQuery]);

  // -- Render -------------------------------------------------------------

  const isLoading = showsQuery.isLoading;
  const hasMappableVenues = !isLoading && venues.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="Map"
        eyebrow={`VENUES · ${venues.length} · ${filteredShows.length} SHOWS`}
        large
      />

      {/* Kind filter strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[
          styles.filterStrip,
          { borderBottomColor: colors.rule },
        ]}
      >
        {KIND_FILTERS.map(({ k, label }) => {
          const active = k === kindFilter;
          const dotColor = k === 'all' ? colors.ink : tokens.kindColor(k);
          return (
            <Pressable
              key={k}
              onPress={() => setKindFilter(k)}
              style={[
                styles.filterChip,
                {
                  borderColor: active ? dotColor : colors.ruleStrong,
                  backgroundColor:
                    active && k === 'all' ? colors.ink : 'transparent',
                },
              ]}
            >
              {k !== 'all' && (
                <View
                  style={[styles.filterDot, { backgroundColor: dotColor }]}
                />
              )}
              <Text
                style={[
                  styles.filterLabel,
                  {
                    color: active
                      ? k === 'all'
                        ? colors.bg
                        : dotColor
                      : colors.muted,
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Map area */}
      <View style={{ flex: 1, backgroundColor: colors.surfaceRaised }}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : !hasMappableVenues ? (
          <EmptyState
            icon={<MapPin size={40} color={colors.faint} strokeWidth={1.5} />}
            title="No venues on the map yet"
            subtitle={
              allShows.length === 0
                ? 'Log a show with a venue and it will land here.'
                : 'None of your matching venues have coordinates yet.'
            }
          />
        ) : (
          <>
            <MapView
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              provider={
                Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT
              }
              initialRegion={DEFAULT_REGION}
              onRegionChangeComplete={onRegionChangeComplete}
              customMapStyle={mode === 'dark' ? darkStyle : lightStyle}
              showsCompass={false}
              showsPointsOfInterests={false}
              toolbarEnabled={false}
            >
              {clusters.map((cluster) => {
                const color = tokens.kindColor(cluster.dominantKind);
                const r = pinRadius(cluster.count);
                const selected = cluster.id === selectedClusterId;
                return (
                  <Marker
                    key={cluster.id}
                    coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
                    onPress={() => onMarkerPress(cluster)}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                  >
                    <View
                      style={[
                        styles.pinOuter,
                        {
                          width: r * 2 + 8,
                          height: r * 2 + 8,
                          borderRadius: r + 4,
                          backgroundColor: selected
                            ? color
                            : `${color}33`,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.pinInner,
                          {
                            width: r * 2,
                            height: r * 2,
                            borderRadius: r,
                            backgroundColor: color,
                            borderColor: selected ? colors.ink : 'transparent',
                            borderWidth: selected ? 1.5 : 0,
                          },
                        ]}
                      >
                        {cluster.count >= 2 && (
                          <Text
                            style={[
                              styles.pinCount,
                              { color: colors.bg, fontSize: r > 14 ? 11 : 10 },
                            ]}
                          >
                            {cluster.count}
                          </Text>
                        )}
                      </View>
                    </View>
                  </Marker>
                );
              })}
            </MapView>

            {shouldShowSearchArea && (
              <Pressable
                onPress={onSearchAreaPress}
                style={[
                  styles.searchAreaButton,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.ruleStrong,
                  },
                ]}
              >
                <Search size={14} color={colors.ink} />
                <Text style={[styles.searchAreaLabel, { color: colors.ink }]}>
                  Search this area
                </Text>
              </Pressable>
            )}
          </>
        )}
      </View>

      <Sheet
        open={selectedCluster !== null && selectedVenue !== null}
        onClose={() => setSelectedClusterId(null)}
        snapPoints={['45%', '85%']}
      >
        {selectedVenue && (
          <VenueSheetContents
            venue={selectedVenue}
            onClose={() => setSelectedClusterId(null)}
          />
        )}
      </Sheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sheet contents
// ---------------------------------------------------------------------------

function VenueSheetContents({
  venue,
  onClose,
}: {
  venue: VenueGroup;
  onClose: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  const totalSpent = venue.shows.reduce((acc, s) => {
    const n = toNumber(s.pricePaid);
    return acc + (n && n > 0 ? n : 0);
  }, 0);

  const uniqueArtists = new Set(
    venue.shows.map((s) => s.headlinerName).filter((n): n is string => Boolean(n)),
  ).size;

  const sortedShows = React.useMemo(
    () =>
      [...venue.shows].sort((a, b) => {
        const ad = a.date ? new Date(a.date).getTime() : 0;
        const bd = b.date ? new Date(b.date).getTime() : 0;
        return bd - ad;
      }),
    [venue],
  );

  const locationLine = [venue.city, venue.stateRegion].filter(Boolean).join(', ');

  return (
    <View style={styles.sheetContainer}>
      <View style={styles.sheetHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.sheetEyebrowRow}>
            <MapPin size={11} color={colors.faint} />
            <Text style={[styles.sheetEyebrow, { color: colors.faint }]}>
              Selected
            </Text>
          </View>
          <Text style={[styles.venueTitle, { color: colors.ink }]} numberOfLines={2}>
            {venue.name}
          </Text>
          {locationLine.length > 0 && (
            <Text style={[styles.venueLocation, { color: colors.muted }]}>
              {locationLine}
            </Text>
          )}
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          style={[styles.closeButton, { borderColor: colors.ruleStrong }]}
        >
          <X size={14} color={colors.ink} />
        </Pressable>
      </View>

      <View style={[styles.statRow, { borderColor: colors.rule }]}>
        <Stat label="Shows" value={String(venue.shows.length)} />
        <View style={[styles.statDivider, { backgroundColor: colors.rule }]} />
        <Stat label="Artists" value={String(uniqueArtists)} />
        <View style={[styles.statDivider, { backgroundColor: colors.rule }]} />
        <Stat
          label="Spent"
          value={totalSpent > 0 ? `$${Math.round(totalSpent)}` : '—'}
        />
      </View>

      <View style={styles.visitsHeader}>
        <Text style={[styles.visitsTitle, { color: colors.ink }]}>All visits</Text>
        <Text style={[styles.visitsCount, { color: colors.faint }]}>
          {sortedShows.length}
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {sortedShows.map((show) => {
          const price = formatPrice(show.pricePaid);
          const date = formatDate(show.date ?? null);
          return (
            <View
              key={show.id}
              style={[styles.visitRow, { borderTopColor: colors.rule }]}
            >
              <View style={{ width: 64 }}>
                <Text style={[styles.visitDate, { color: colors.ink }]}>
                  {date || '—'}
                </Text>
                <View
                  style={[
                    styles.kindDot,
                    { backgroundColor: tokens.kindColor(show.kind) },
                  ]}
                />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                  style={[styles.visitArtist, { color: colors.ink }]}
                  numberOfLines={1}
                >
                  {show.headlinerName ?? 'Untitled show'}
                </Text>
                {show.seat && (
                  <Text
                    style={[styles.visitSeat, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    {show.seat}
                  </Text>
                )}
              </View>
              {price && (
                <Text style={[styles.visitPrice, { color: colors.muted }]}>
                  {price}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  const { tokens } = useTheme();
  return (
    <View style={styles.statCell}>
      <Text style={[styles.statValue, { color: tokens.colors.ink }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: tokens.colors.muted }]}>
        {label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  filterStrip: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 6,
    flexDirection: 'row',
    borderBottomWidth: 1,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  filterDot: { width: 5, height: 5, borderRadius: 999 },
  filterLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  pinOuter: { alignItems: 'center', justifyContent: 'center' },
  pinInner: { alignItems: 'center', justifyContent: 'center' },
  pinCount: { fontFamily: 'Geist Sans', fontWeight: '600' },
  searchAreaButton: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  searchAreaLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '600',
  },
  sheetContainer: { flex: 1, paddingTop: 4 },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 12,
  },
  sheetEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  sheetEyebrow: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  venueTitle: {
    fontFamily: 'Georgia',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  venueLocation: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    marginTop: 4,
  },
  closeButton: {
    width: 28,
    height: 28,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  statRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    borderWidth: 1,
  },
  statDivider: { width: 1 },
  statCell: { flex: 1, paddingVertical: 10, paddingHorizontal: 12 },
  statValue: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '600',
  },
  statLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 9,
    marginTop: 4,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  visitsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  visitsTitle: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  visitsCount: {
    fontFamily: 'Geist Sans',
    fontSize: 10,
  },
  visitRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderTopWidth: 1,
    alignItems: 'center',
    gap: 12,
  },
  visitDate: {
    fontFamily: 'Geist Sans',
    fontSize: 13.5,
    fontWeight: '500',
  },
  kindDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    marginTop: 4,
  },
  visitArtist: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
  },
  visitSeat: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    marginTop: 2,
  },
  visitPrice: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '500',
  },
});
