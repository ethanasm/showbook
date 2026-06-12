/**
 * Map tab — M2.
 *
 * Personal map of every show the signed-in user has logged. Pins are
 * positioned at venue coordinates, bucketed into a grid that re-evaluates
 * as the user pans/zooms. Tapping a single-venue pin opens a sheet listing
 * every visit at that venue; tapping a multi-venue *aggregate* opens the
 * same sheet scoped to the whole cluster — every show across its venues,
 * filterable by venue, with a "Zoom in" affordance to spread the pins
 * apart on the map. (Aggregates used to only nudge the camera, which left
 * tightly-clustered / coincident venues permanently un-openable.)
 *
 * Data source: trpc.shows.listForMap (already returns the headliner name
 * and venue lat/lng). We do NOT call a region-scoped procedure — clusters
 * re-evaluate client-side as the user pans/zooms. The map refetches
 * whenever the tab regains focus, so adding or removing a show (logbook or
 * discovery) on another screen is reflected automatically on return.
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
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { MapPin, X, ZoomIn } from 'lucide-react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  PROVIDER_DEFAULT,
  type Region,
} from 'react-native-maps';
import { effectiveShowState, type Kind } from '@showbook/shared';
import { TopBar } from '../../components/TopBar';
import { MeTopBarAction } from '../../components/MeTopBarAction';
import { KindFilterControl } from '../../components/KindFilterControl';
import { type KindFilterValue } from '../../components/KindFilterMenu';
import { EmptyState } from '../../components/EmptyState';
import { ErrorBoundary } from '../../components/ErrorBoundary';
import { Sheet } from '../../components/Sheet';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/lib/auth';
import { useCachedQuery } from '@/lib/cache';
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

interface FocusRegion {
  id: string;
  label: string;
  region: Region;
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

// Hard cap on markers handed to the native map at once. The Discoverable
// layer can resolve into thousands of announcements spread nationwide
// and Apple Maps (iOS PROVIDER_DEFAULT) becomes unstable when many
// custom-view markers churn in a single render. Viewport culling alone
// isn't enough at continental zoom, so we additionally cap by marker
// count — clusters are ranked by `count` so the densest venues survive.
const MAX_VISIBLE_MARKERS = 60;

// Clamp Region deltas to something Apple Maps reliably renders. A
// global fit (e.g. announcements in both Hawaii and the East Coast)
// can otherwise compute a 100°+ longitude delta, which combined with
// dozens of marker creations in the same render has been observed to
// hard-crash the native map. 60° latitude × 120° longitude still
// shows the continental US end-to-end.
const MAX_REGION_LAT_DELTA = 60;
const MAX_REGION_LNG_DELTA = 120;

// Which layer of shows the map plots. `all` / `past` / `upcoming` split the
// user's own logbook by show state (`all` is the whole logbook, labelled
// "my shows" in the UI); `discoverable` swaps in the announcements that
// power the three Discover tabs (followed venues / artists / regions).
type MapMode = 'all' | 'past' | 'upcoming' | 'discoverable';

const MODE_FILTERS: readonly { m: MapMode; label: string }[] = [
  { m: 'all', label: 'my shows' },
  { m: 'past', label: 'past' },
  { m: 'upcoming', label: 'upcoming' },
  { m: 'discoverable', label: 'discoverable' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// Stricter than `Number.isFinite`: rejects coordinates that fall outside
// the WGS84 valid range. A bad row in the discoverable feed (e.g. an
// announcement whose venue still has placeholder lat/lng like 0/0 from
// a partial geocode, or values out of bounds from a stale import) would
// otherwise skew `fitRegion` into an unrenderable delta and feed Apple
// Maps a coordinate it refuses to plot.
function isPlottableCoord(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -85 &&
    lat <= 85 &&
    lng >= -180 &&
    lng <= 180 &&
    // Treat exact 0/0 as "no coords yet" — Null Island is almost
    // always a placeholder rather than a real venue, and it
    // dramatically widens fitRegion when mixed with US venues.
    !(lat === 0 && lng === 0)
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function groupByVenue(shows: MapShow[]): VenueGroup[] {
  const byId = new Map<string, VenueGroup>();
  for (const show of shows) {
    const lat = toNumber(show.venue.latitude);
    const lng = toNumber(show.venue.longitude);
    if (lat === null || lng === null) continue;
    if (!isPlottableCoord(lat, lng)) continue;
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
 *
 * The divisor (`/ 6`) is intentionally smaller than what looks "right"
 * at high zoom — at low zoom we want aggressive clustering so the
 * native map never sees more than a couple dozen markers, which is
 * what was crashing the iOS Discoverable layer.
 */
function clusterVenues(venues: VenueGroup[], region: Region): Cluster[] {
  const cellSize = Math.max(region.longitudeDelta / 6, 0.0008);
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

/**
 * Viewport cull + hard cap. The `discoverable` layer can resolve into
 * thousands of announcements spread nationwide; handing a marker for
 * every one to the native map is what crashed the app on that layer.
 *
 * 1) Drop clusters outside a lightly-padded box around the current
 *    region — off-screen pins are never visible anyway.
 * 2) Sort the survivors by show count (densest venues first) and keep
 *    at most `MAX_VISIBLE_MARKERS`. The cap matters because at low
 *    zoom the padded viewport can still contain every cluster, and
 *    Apple Maps becomes unstable past a few dozen custom-view markers
 *    churning between renders (which is what happens on a layer
 *    switch).
 */
function visibleClustersFor(clusters: Cluster[], region: Region): Cluster[] {
  const latPad = region.latitudeDelta * 0.6 + 0.0005;
  const lngPad = region.longitudeDelta * 0.6 + 0.0005;
  const inView = clusters.filter(
    (c) =>
      Math.abs(c.lat - region.latitude) <= latPad &&
      Math.abs(c.lng - region.longitude) <= lngPad,
  );
  if (inView.length <= MAX_VISIBLE_MARKERS) return inView;
  // Densest clusters survive. Each surviving cluster has a stable id,
  // so React-Native-Maps' marker reconciliation isn't disrupted by
  // arbitrary slice ordering.
  return [...inView]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_VISIBLE_MARKERS);
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
  // Clamp deltas — a nationwide-spread discoverable feed can otherwise
  // produce a region wide enough to destabilise Apple Maps when the
  // marker set churns. See MAX_REGION_*_DELTA notes above.
  const latDelta = clamp((maxLat - minLat) * 1.4, 0.05, MAX_REGION_LAT_DELTA);
  const lngDelta = clamp((maxLng - minLng) * 1.4, 0.05, MAX_REGION_LNG_DELTA);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
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

/**
 * Convert a saved region (lat/lng + radius in miles) into a react-native-maps
 * `Region` framed so the radius fits horizontally with a little padding.
 * 1° latitude ≈ 69mi, longitude is widened to stay roughly square across
 * mid-latitude US viewports.
 */
function regionFromFocus(
  latitude: number,
  longitude: number,
  radiusMiles: number,
): Region {
  const safe = Math.max(radiusMiles, 1);
  const latDelta = Math.max((safe * 2 * 1.4) / 69, 0.05);
  return {
    latitude,
    longitude,
    latitudeDelta: latDelta,
    longitudeDelta: latDelta,
  };
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
  const router = useRouter();
  const params = useLocalSearchParams<{ focusVenueId?: string | string[] }>();
  const focusVenueId = React.useMemo(() => {
    const v = params.focusVenueId;
    if (Array.isArray(v)) return v[0] ?? null;
    return v ?? null;
  }, [params.focusVenueId]);

  const utils = trpc.useUtils();
  const showsQuery = useCachedQuery<MapShow[]>({
    queryKey: ['mobile', 'shows.listForMap'],
    queryFn: () => utils.client.shows.listForMap.query() as Promise<MapShow[]>,
    enabled: Boolean(token),
  });
  const mapFeedQuery = useCachedQuery<MapShow[]>({
    queryKey: ['mobile', 'discover.mapFeed'],
    queryFn: () => utils.client.discover.mapFeed.query() as Promise<MapShow[]>,
    enabled: Boolean(token),
  });

  const [layer, setLayer] = React.useState<MapMode>('past');
  const [pendingRefit, setPendingRefit] = React.useState(false);
  const [kindFilter, setKindFilter] = React.useState<KindFilterValue>('all');
  const [region, setRegion] = React.useState<Region>(DEFAULT_REGION);
  // The opened cluster is held as a *snapshot* (not just an id) so the
  // sheet keeps rendering its contents even if a pan/zoom re-buckets the
  // grid and changes a multi-venue cluster's synthetic `c:<key>` id.
  const [selectedCluster, setSelectedCluster] = React.useState<Cluster | null>(null);
  const [didFitOnce, setDidFitOnce] = React.useState(false);
  const [activeFocusId, setActiveFocusId] = React.useState<string | null>(null);

  // Bottom-right focus toggle is driven by the user's active followed
  // regions (max 5, enforced by `preferences.addRegion`). Inactive regions
  // stay out so the toggle matches what the discover feed and daily digest
  // already respect. `preferences.get` is in the offline warm-up walker, so
  // these read from the persisted cache on a cold offline open.
  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const focusRegions = React.useMemo<FocusRegion[]>(() => {
    const regions = prefsQuery.data?.regions ?? [];
    return regions
      .filter((r) => r.active)
      .map((r) => ({
        id: r.id,
        label: r.cityName,
        region: regionFromFocus(r.latitude, r.longitude, r.radiusMiles),
      }));
  }, [prefsQuery.data?.regions]);

  // Drop the active highlight if the user removes/deactivates the focused
  // region while the toggle is open.
  React.useEffect(() => {
    if (activeFocusId && !focusRegions.some((f) => f.id === activeFocusId)) {
      setActiveFocusId(null);
    }
  }, [activeFocusId, focusRegions]);

  const onFocusPress = React.useCallback((focus: FocusRegion) => {
    setActiveFocusId(focus.id);
    mapRef.current?.animateToRegion(focus.region, 400);
  }, []);

  const loggedShows = React.useMemo(
    // Effective state keeps the Past/Upcoming layers in step with Home and
    // Shows: a ticketed show counts as past 3 h after its doors anchor.
    () =>
      ((showsQuery.data ?? []) as MapShow[]).map((s) => ({
        ...s,
        state: effectiveShowState(s.state, s.date),
      })),
    [showsQuery.data],
  );
  const discoverableShows = React.useMemo(
    () => (mapFeedQuery.data ?? []) as MapShow[],
    [mapFeedQuery.data],
  );

  // The active layer: `discoverable` swaps in the Discover announcements;
  // `all` is the whole personal logbook; `past` / `upcoming` split it by
  // show state.
  const allShows = React.useMemo<MapShow[]>(() => {
    if (layer === 'discoverable') return discoverableShows;
    if (layer === 'all') return loggedShows;
    return layer === 'past'
      ? loggedShows.filter((s) => s.state === 'past')
      : loggedShows.filter((s) => s.state !== 'past');
  }, [layer, loggedShows, discoverableShows]);

  // Pill counts — derived client-side from the already-loaded query data,
  // so they add no network round-trip. Mode counts are the per-layer
  // totals; kind counts are scoped to the active layer.
  const modeCounts = React.useMemo<Record<MapMode, number>>(() => {
    const past = loggedShows.filter((s) => s.state === 'past').length;
    return {
      all: loggedShows.length,
      past,
      upcoming: loggedShows.length - past,
      discoverable: discoverableShows.length,
    };
  }, [loggedShows, discoverableShows]);

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

  // Only the markers inside the viewport (and capped to a safe count)
  // are handed to the native map — see `visibleClustersFor` for why
  // (the Discoverable-layer crash).
  const visibleClusters = React.useMemo(
    () => visibleClustersFor(clusters, region),
    [clusters, region],
  );

  // Fit camera to the user's venues once, on first successful load.
  // Skipped when an inbound `focusVenueId` is going to override the
  // camera anyway — otherwise the user would see a flash of the full
  // collection before the focus animation lands.
  React.useEffect(() => {
    if (didFitOnce) return;
    if (!showsQuery.isSuccess) return;
    if (focusVenueId) return;
    const allVenues = groupByVenue(allShows);
    if (allVenues.length === 0) return;
    const fit = fitRegion(allVenues);
    setRegion(fit);
    mapRef.current?.animateToRegion(fit, 400);
    setDidFitOnce(true);
  }, [showsQuery.isSuccess, allShows, didFitOnce, focusVenueId]);

  // External focus — e.g. the "Venue map" row on a past show's Media
  // tab routes here with `?focusVenueId=<id>`. We resolve the venue
  // out of the user's already-loaded show set, animate to a tight
  // region around it, and pop the venue sheet so the user lands on
  // the same UI they'd see after tapping the pin manually. The route
  // param is cleared after consumption so a later tab refocus doesn't
  // re-trigger the animation.
  React.useEffect(() => {
    if (!focusVenueId) return;
    if (!showsQuery.isSuccess) return;
    const allVenues = groupByVenue(allShows);
    const target = allVenues.find((v) => v.venueId === focusVenueId);
    if (!target) {
      // Venue isn't in the user's show set (deleted, missing coords);
      // drop the param so we don't keep re-evaluating on every render.
      router.setParams({ focusVenueId: '' });
      return;
    }
    const next: Region = {
      latitude: target.lat,
      longitude: target.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };
    setRegion(next);
    mapRef.current?.animateToRegion(next, 400);
    setDidFitOnce(true);
    setSelectedCluster({
      id: `v:${target.venueId}`,
      lat: target.lat,
      lng: target.lng,
      count: target.shows.length,
      dominantKind: dominantKind(target.shows),
      venues: [target],
    });
    router.setParams({ focusVenueId: '' });
  }, [focusVenueId, showsQuery.isSuccess, allShows, router]);

  const onLayerChange = React.useCallback((next: MapMode) => {
    setLayer(next);
    setSelectedCluster(null);
    setPendingRefit(true);
  }, []);

  // After a layer switch, refit the camera once the new layer's venues
  // are available — the discoverable feed may resolve a tick later than
  // the state flip, so this keys on `allShows` and clears once it fires.
  React.useEffect(() => {
    if (!pendingRefit) return;
    const layerVenues = groupByVenue(allShows);
    if (layerVenues.length === 0) return;
    const fit = fitRegion(layerVenues);
    setRegion(fit);
    mapRef.current?.animateToRegion(fit, 400);
    setPendingRefit(false);
  }, [pendingRefit, allShows]);

  const onRegionChangeComplete = React.useCallback((next: Region) => {
    setRegion(next);
  }, []);

  // Every cluster — single-venue or aggregate — opens the sheet on tap.
  // Aggregates used to only zoom, which left clusters of coincident /
  // very-close venues permanently un-openable once the zoom step hit its
  // floor (those were the "circles I can't click"). The sheet now exposes
  // every show in the aggregate, filterable by venue, and offers an
  // explicit "Zoom in" affordance to spread the pins apart on the map.
  const onMarkerPress = React.useCallback((cluster: Cluster) => {
    setSelectedCluster(cluster);
  }, []);

  // Animate the camera one zoom step into a cluster's center — used by the
  // sheet's "Zoom in" action so the user can still drill the map down to
  // finer-grain pins when an aggregate spans separable venues.
  const zoomToCluster = React.useCallback(
    (cluster: Cluster) => {
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

  // Keep the map fresh without a manual "Refresh map" button: refetch both
  // feeds whenever the tab regains focus. Adding or removing a show (logbook
  // or discovery) happens on another screen, so returning to Map picks up
  // the change automatically. The one-time camera fit is gated by
  // `didFitOnce`, so a refetch updates the pins in place without re-framing.
  useFocusEffect(
    React.useCallback(() => {
      if (!token) return;
      void showsQuery.refetch();
      void mapFeedQuery.refetch();
      // Intentionally exclude the query objects from deps — refetch on every
      // focus, not on every query-identity change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]),
  );

  // -- Render -------------------------------------------------------------

  const isLoading =
    layer === 'discoverable' ? mapFeedQuery.isLoading : showsQuery.isLoading;
  const hasMappableVenues = !isLoading && venues.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title="Map"
        eyebrow={`${venues.length} ${venues.length === 1 ? 'VENUE' : 'VENUES'}`}
        rightAction={
          <View style={styles.headerActions}>
            <KindFilterControl value={kindFilter} onChange={setKindFilter} testIDPrefix="map" />
            <MeTopBarAction />
          </View>
        }
        large
      />

      {/* Layer toggle — my shows / past / upcoming, then discoverable
          behind a divider: the first three slice the personal logbook,
          while discoverable swaps in a different dataset (the Discover
          announcements feed), so the rule keeps it from reading as a
          fourth logbook subset. Fixed non-scrolling row: chips size to
          their label and can shrink to fit narrow screens rather than
          scrolling. Counts were dropped. */}
      <View style={styles.modeStrip}>
        {MODE_FILTERS.map(({ m, label }) => {
          const active = m === layer;
          return (
            <React.Fragment key={m}>
              {m === 'discoverable' && (
                <View
                  style={[styles.modeDivider, { backgroundColor: colors.ruleStrong }]}
                />
              )}
              <Pressable
                onPress={() => onLayerChange(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${label} (${modeCounts[m]})`}
                style={[
                  styles.filterChip,
                  styles.modeChip,
                  {
                    borderColor: active ? colors.ink : colors.ruleStrong,
                    backgroundColor: active ? colors.ink : 'transparent',
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                  style={[
                    styles.filterLabel,
                    { color: active ? colors.bg : colors.muted },
                  ]}
                >
                  {label}
                </Text>
              </Pressable>
            </React.Fragment>
          );
        })}
      </View>

      {/* Map area — the kind filter that used to live in a pill strip here
          now lives in the header filter button, giving the map the full
          height between the mode strip and the tab bar. */}
      <View style={{ flex: 1, backgroundColor: colors.surfaceRaised }}>
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.muted} />
          </View>
        ) : !hasMappableVenues ? (
          <EmptyState
            icon={<MapPin size={40} color={colors.faint} strokeWidth={1.5} />}
            title={
              layer === 'discoverable'
                ? 'Nothing to discover yet'
                : 'No venues on the map yet'
            }
            subtitle={
              allShows.length > 0
                ? 'None of your matching venues have coordinates yet.'
                : layer === 'all'
                  ? 'Log a show with a venue and it lands here.'
                  : layer === 'past'
                    ? 'Log a past show with a venue and it lands here.'
                    : layer === 'upcoming'
                      ? 'Ticketed and watchlisted shows land here.'
                      : 'Follow venues, artists, or regions to discover shows here.'
            }
          />
        ) : (
          // Local boundary so a render-time failure inside MapView /
          // Marker children (e.g. a bad coordinate that snuck past our
          // sanitisers) shows the recovery card on this tab instead of
          // crashing the whole app like the Discoverable layer used to.
          <ErrorBoundary
            fallback={({ reset }) => (
              <EmptyState
                icon={<MapPin size={40} color={colors.faint} strokeWidth={1.5} />}
                title="Map failed to load"
                subtitle="Try switching layers or tap below to retry."
                cta={{ label: 'Try again', onPress: reset }}
              />
            )}
          >
            {/*
              * `key={layer}` remounts the MapView whenever the layer
              * pill changes. That gives Apple Maps (iOS PROVIDER_DEFAULT)
              * a clean teardown of every native marker between layers,
              * so a switch into Discoverable doesn't have to reconcile
              * dozens of past-layer markers + dozens of new ones in a
              * single render — which is what was crashing the app even
              * after the viewport cull was added.
              */}
            <MapView
              key={layer}
              ref={mapRef}
              style={StyleSheet.absoluteFill}
              provider={
                Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT
              }
              initialRegion={region}
              onRegionChangeComplete={onRegionChangeComplete}
              // Apple Maps silently ignores customMapStyle, so only
              // pass it on Android (Google Maps) where it actually
              // applies — avoids a known iOS instability path.
              {...(Platform.OS === 'android'
                ? { customMapStyle: mode === 'dark' ? darkStyle : lightStyle }
                : null)}
              showsCompass={false}
              showsPointsOfInterests={false}
              toolbarEnabled={false}
            >
              {visibleClusters.map((cluster) => {
                const color = tokens.kindColor(cluster.dominantKind);
                const r = pinRadius(cluster.count);
                const selected = cluster.id === selectedCluster?.id;
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

            {focusRegions.length > 0 && (
              <View
                style={[
                  styles.focusToggle,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.rule,
                  },
                ]}
              >
                {focusRegions.map((focus, i) => {
                  const active = focus.id === activeFocusId;
                  return (
                    <Pressable
                      key={focus.id}
                      onPress={() => onFocusPress(focus)}
                      style={({ pressed }) => [
                        styles.focusToggleBtn,
                        i > 0 && {
                          borderTopColor: colors.rule,
                          borderTopWidth: StyleSheet.hairlineWidth,
                        },
                        active && { backgroundColor: colors.ink },
                        pressed && !active && { backgroundColor: colors.surfaceRaised },
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`Focus map on ${focus.label}`}
                    >
                      <MapPin
                        size={12}
                        color={active ? colors.bg : colors.faint}
                        strokeWidth={2}
                      />
                      <Text
                        style={[
                          styles.focusToggleLabel,
                          { color: active ? colors.bg : colors.muted },
                        ]}
                        numberOfLines={1}
                      >
                        {focus.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </ErrorBoundary>
        )}
      </View>

      <Sheet
        open={selectedCluster !== null}
        onClose={() => setSelectedCluster(null)}
        snapPoints={[
          selectedCluster && selectedCluster.venues.length > 1 ? '80%' : '55%',
        ]}
      >
        {selectedCluster && (
          <ClusterSheetContents
            key={selectedCluster.id}
            cluster={selectedCluster}
            onClose={() => setSelectedCluster(null)}
            layer={layer}
            onZoomIn={() => {
              const target = selectedCluster;
              setSelectedCluster(null);
              zoomToCluster(target);
            }}
          />
        )}
      </Sheet>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sheet contents
// ---------------------------------------------------------------------------

function ClusterSheetContents({
  cluster,
  onClose,
  layer,
  onZoomIn,
}: {
  cluster: Cluster;
  onClose: () => void;
  layer: MapMode;
  onZoomIn: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();

  const isAggregate = cluster.venues.length > 1;

  // Venue filter for an aggregate. `all` shows every venue in the cluster;
  // selecting a venue narrows the list to that one. The sheet is keyed by
  // cluster id at the call site, so this remounts (and resets to `all`)
  // whenever a different cluster is opened — no reset-in-effect needed.
  const [venueFilter, setVenueFilter] = React.useState<'all' | string>('all');

  const activeVenue =
    venueFilter === 'all'
      ? null
      : (cluster.venues.find((v) => v.venueId === venueFilter) ?? null);

  // When a single venue is in focus (single-venue cluster, or an aggregate
  // narrowed to one venue) the header reads as that venue and rows omit the
  // venue line. Otherwise the header summarises the area.
  const focusVenue = isAggregate ? activeVenue : cluster.venues[0]!;
  const showVenueLine = isAggregate && !activeVenue;

  // Past visits read newest-first; upcoming / discoverable shows read
  // soonest-first so the next thing to happen sits at the top.
  const sortedShows = React.useMemo(() => {
    const source = activeVenue
      ? activeVenue.shows.map((s) => ({ show: s, venue: activeVenue }))
      : cluster.venues.flatMap((v) => v.shows.map((s) => ({ show: s, venue: v })));
    return source.sort((a, b) => {
      const ad = a.show.date ? new Date(a.show.date).getTime() : 0;
      const bd = b.show.date ? new Date(b.show.date).getTime() : 0;
      return layer === 'past' ? bd - ad : ad - bd;
    });
  }, [cluster, activeVenue, layer]);

  const totalSpent = sortedShows.reduce((acc, { show }) => {
    const n = toNumber(show.pricePaid);
    return acc + (n && n > 0 ? n : 0);
  }, 0);
  const uniqueArtists = new Set(
    sortedShows
      .map(({ show }) => show.headlinerName)
      .filter((n): n is string => Boolean(n)),
  ).size;

  // Header copy. A focused venue shows its own city/state; an unfiltered
  // aggregate summarises the spread of cities it covers.
  const cities = Array.from(
    new Set(
      cluster.venues.map((v) => v.city).filter((c): c is string => Boolean(c)),
    ),
  );
  const areaLine =
    cities.length === 1
      ? cities[0]!
      : cities.length > 1
        ? `${cities.length} cities`
        : '';
  const focusLocationLine = focusVenue
    ? [focusVenue.city, focusVenue.stateRegion].filter(Boolean).join(', ')
    : '';

  return (
    <View style={styles.sheetContainer}>
      <View style={styles.sheetHeader}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.sheetEyebrowRow}>
            <MapPin size={11} color={colors.faint} />
            <Text style={[styles.sheetEyebrow, { color: colors.faint }]}>
              {showVenueLine ? 'This area' : 'Selected'}
            </Text>
          </View>
          {focusVenue ? (
            <Pressable
              onPress={() => {
                onClose();
                router.push(`/venues/${focusVenue.venueId}`);
              }}
              accessibilityRole="link"
              accessibilityLabel={`Open ${focusVenue.name}`}
              hitSlop={4}
              style={({ pressed }) => [pressed && { opacity: 0.6 }]}
            >
              <Text
                style={[styles.venueTitle, { color: colors.ink }]}
                numberOfLines={2}
              >
                {focusVenue.name}
              </Text>
            </Pressable>
          ) : (
            <Text
              style={[styles.venueTitle, { color: colors.ink }]}
              numberOfLines={2}
            >
              {cluster.venues.length} venues
            </Text>
          )}
          {(focusVenue ? focusLocationLine : areaLine).length > 0 && (
            <Text style={[styles.venueLocation, { color: colors.muted }]}>
              {focusVenue ? focusLocationLine : areaLine}
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

      {/* Venue filter rail — only for aggregates. Lets the user scope the
          show list to any single venue inside the cluster (the "filterable
          by venue" view of an aggregate that has no separable pins yet). */}
      {isAggregate && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.venueFilterScroll}
          contentContainerStyle={styles.venueFilterRail}
        >
          {[
            { id: 'all' as const, name: 'All venues', count: cluster.count },
            ...cluster.venues
              .slice()
              .sort((a, b) => b.shows.length - a.shows.length)
              .map((v) => ({
                id: v.venueId,
                name: v.name,
                count: v.shows.length,
              })),
          ].map((chip) => {
            const active = chip.id === venueFilter;
            return (
              <Pressable
                key={chip.id}
                onPress={() => setVenueFilter(chip.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${chip.name} (${chip.count})`}
                style={[
                  styles.venueFilterChip,
                  {
                    borderColor: active ? colors.ink : colors.ruleStrong,
                    backgroundColor: active ? colors.ink : 'transparent',
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.venueFilterLabel,
                    { color: active ? colors.bg : colors.muted },
                  ]}
                >
                  {chip.name}
                </Text>
                <Text
                  style={[
                    styles.venueFilterCount,
                    { color: active ? colors.bg : colors.faint },
                  ]}
                >
                  {chip.count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.statRow, { borderColor: colors.rule }]}>
        {showVenueLine && (
          <>
            <Stat label="Venues" value={String(cluster.venues.length)} />
            <View style={[styles.statDivider, { backgroundColor: colors.rule }]} />
          </>
        )}
        <Stat label="Shows" value={String(sortedShows.length)} />
        <View style={[styles.statDivider, { backgroundColor: colors.rule }]} />
        <Stat label="Artists" value={String(uniqueArtists)} />
        {!showVenueLine && (
          <>
            <View style={[styles.statDivider, { backgroundColor: colors.rule }]} />
            <Stat
              label="Spent"
              value={totalSpent > 0 ? `$${Math.round(totalSpent)}` : '—'}
            />
          </>
        )}
      </View>

      {isAggregate && (
        <Pressable
          onPress={onZoomIn}
          accessibilityRole="button"
          accessibilityLabel="Zoom in to separate these venues on the map"
          style={({ pressed }) => [
            styles.zoomButton,
            { borderColor: colors.ruleStrong },
            pressed && { opacity: 0.7 },
          ]}
        >
          <ZoomIn size={14} color={colors.ink} />
          <Text style={[styles.zoomButtonLabel, { color: colors.ink }]}>
            Zoom in on map
          </Text>
        </Pressable>
      )}

      <View style={styles.visitsHeader}>
        <Text style={[styles.visitsTitle, { color: colors.ink }]}>
          {layer === 'past' && !showVenueLine ? 'All visits' : 'Shows'}
        </Text>
        <Text style={[styles.visitsCount, { color: colors.faint }]}>
          {sortedShows.length}
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }}>
        {sortedShows.map(({ show, venue }) => {
          const price = formatPrice(show.pricePaid);
          const date = formatDate(show.date ?? null);
          const goToShow = () => {
            onClose();
            router.push(`/show/${show.id}`);
          };
          const goToArtist = show.headlinerId
            ? () => {
                onClose();
                router.push(`/artists/${show.headlinerId}`);
              }
            : null;
          return (
            <Pressable
              key={show.id}
              onPress={goToShow}
              accessibilityRole="link"
              accessibilityLabel={`Open show on ${date || 'unknown date'}`}
              style={({ pressed }) => [
                styles.visitRow,
                { borderTopColor: colors.rule },
                pressed && { opacity: 0.7 },
              ]}
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
                {goToArtist ? (
                  <Text
                    onPress={goToArtist}
                    accessibilityRole="link"
                    accessibilityLabel={`Open ${show.headlinerName ?? 'artist'}`}
                    style={[styles.visitArtist, { color: colors.ink }]}
                    numberOfLines={1}
                  >
                    {show.headlinerName ?? 'Untitled show'}
                  </Text>
                ) : (
                  <Text
                    style={[styles.visitArtist, { color: colors.ink }]}
                    numberOfLines={1}
                  >
                    {show.headlinerName ?? 'Untitled show'}
                  </Text>
                )}
                {/* In the unfiltered aggregate view, surface which venue
                    each show belongs to so the list stays legible. */}
                {showVenueLine ? (
                  <Text
                    style={[styles.visitSeat, { color: colors.muted }]}
                    numberOfLines={1}
                  >
                    {venue.name}
                  </Text>
                ) : (
                  show.seat && (
                    <Text
                      style={[styles.visitSeat, { color: colors.muted }]}
                      numberOfLines={1}
                    >
                      {show.seat}
                    </Text>
                  )
                )}
              </View>
              {price && (
                <Text style={[styles.visitPrice, { color: colors.muted }]}>
                  {price}
                </Text>
              )}
            </Pressable>
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
  modeStrip: {
    // Tighter than the old 20/8 — "my shows" + the divider need the extra
    // room for all four labels to fit untruncated on a 390pt screen.
    paddingHorizontal: 12,
    // No top padding: the large TopBar already supplies the header gap, so
    // the lone (post-kind-strip-removal) filter row sits tight under it
    // instead of floating in blank space. Centred so the four chips read as
    // a balanced group rather than left-anchored.
    paddingTop: 0,
    paddingBottom: 10,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Mode chips size to their label (not equal-width) and may shrink to fit
  // a narrow screen instead of overflowing the fixed, non-scrolling row.
  modeChip: {
    flexShrink: 1,
  },
  // Vertical rule between the logbook chips (my shows / past / upcoming)
  // and discoverable, which plots a different dataset.
  modeDivider: {
    width: 1,
    height: 16,
  },
  filterStrip: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 6,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  filterChip: {
    paddingVertical: 6,
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: RADII.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  filterLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  pinOuter: { alignItems: 'center', justifyContent: 'center' },
  pinInner: { alignItems: 'center', justifyContent: 'center' },
  pinCount: { fontFamily: 'Geist Sans 600' },
  focusToggle: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    flexDirection: 'column',
    alignItems: 'stretch',
    minWidth: 140,
    maxWidth: 220,
    borderWidth: 1,
    borderRadius: RADII.lg,
    overflow: 'hidden',
  },
  focusToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  focusToggleLabel: {
    flexShrink: 1,
    fontFamily: 'Geist Mono 500',
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
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
    fontFamily: 'Geist Sans 500',
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  venueTitle: {
    fontFamily: 'Fraunces',
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
    borderRadius: RADII.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  // A horizontal ScrollView is a flex child and would otherwise stretch to
  // fill the column's free space; pin it to its content height.
  venueFilterScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  venueFilterRail: {
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  venueFilterChip: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderRadius: RADII.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
  },
  venueFilterLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 12,
    flexShrink: 1,
  },
  venueFilterCount: {
    fontFamily: 'Geist Mono 500',
    fontSize: 10,
  },
  zoomButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    marginHorizontal: 20,
    marginTop: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderRadius: RADII.md,
  },
  zoomButtonLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 12,
    letterSpacing: 0.4,
  },
  statRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    borderWidth: 1,
  },
  statDivider: { width: 1 },
  statCell: { flex: 1, paddingVertical: 10, paddingHorizontal: 12 },
  statValue: {
    fontFamily: 'Geist Sans 600',
    fontSize: 17,
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
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
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
    fontFamily: 'Geist Sans 500',
    fontSize: 13.5,
  },
  kindDot: {
    width: 6,
    height: 6,
    borderRadius: RADII.pill,
    marginTop: 4,
  },
  visitArtist: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13,
  },
  visitSeat: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    marginTop: 2,
  },
  visitPrice: {
    fontFamily: 'Geist Sans 500',
    fontSize: 11,
  },
});
