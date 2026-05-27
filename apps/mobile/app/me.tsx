/**
 * Me tab v2 — account, integrations, region, density/theme, activity, sign-out.
 *
 * Layout follows docs/design/hifi/prefs.jsx (PrefsMobile) within the limits of
 * what M2 actually exposes:
 *   - User card row (avatar circle + name + signed-in email)
 *   - INTEGRATIONS section: Gmail / Ticketmaster / Google Places.
 *     Tapping a row pushes /integrations/[id]. Ticketmaster + Google
 *     Places resolve to the "built-in" detail screen (app-wide API keys,
 *     always-on), Gmail falls back to the "manage from web" placeholder
 *     until a mobile OAuth bridge lands. See `useIntegrationStatus` below
 *     for the row-status branch.
 *   - REGION section: tappable row that pushes /regions, which lists the
 *     full set of saved regions and exposes the same add / remove /
 *     toggle controls as web Preferences (capped at 5 per user via
 *     `preferences.addRegion`).
 *   - APPEARANCE section: Theme (Light / Dark / System) + Density
 *     (Comfortable / Compact). Density is persisted locally via
 *     useTheme().setDensity (see lib/theme.ts).
 *   - ACCOUNT section: Sign out (destructive).
 *   - ADMIN section: operator-only, rendered only when `admin.amIAdmin`
 *     returns true. Mirrors the web /admin page — the section + its
 *     confirmation sheet live in components/AdminSection.tsx.
 *   - SHOWBOOK · vX footer (version read from expoConfig).
 *
 * Sign-out: confirmation Alert before clearing the SecureStore session.
 * After signOut(), `useAuth().user` is null, which makes app/index.tsx
 * redirect to /(auth)/signin on the next render. We also call
 * router.replace('/(auth)/signin') explicitly so the screen swaps even
 * if the index gate doesn't re-mount immediately.
 */

import React from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import Constants from 'expo-constants';
import {
  Mail,
  Ticket,
  MapPin,
  ChevronLeft,
  ChevronRight,
  CloudUpload,
  Music,
  RefreshCw,
} from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { ScreenWrapper } from '../components/ScreenWrapper';
import { SegmentedControl } from '../components/SegmentedControl';
import { AdminSection } from '../components/AdminSection';
import { useTheme, type ThemePreference, type Density } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useAuth } from '@/lib/auth';
import { trpc } from '@/lib/trpc';
import { useNetwork, useOfflineSync } from '@/lib/network';
import { useFeedback } from '@/lib/feedback';
import { useSpotifyConnection } from '@/lib/spotify-connection';
import {
  readLastWarmup,
  warmCacheForOfflineUse,
} from '@/lib/cache/warmup';

interface IntegrationRow {
  id: 'gmail' | 'ticketmaster' | 'google-places' | 'spotify';
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}

// INTEGRATIONS: the prefs router exposes user preferences + saved regions
// but not third-party connection status for Gmail / Ticketmaster /
// Google Places. Spotify is the exception — Phase 0 of setlist-
// intelligence shipped `useSpotifyConnection` which the Spotify row
// special-cases below to surface "Connected to {handle}" + a tap that
// drives connect/disconnect.
const INTEGRATIONS: readonly IntegrationRow[] = [
  { id: 'spotify', label: 'Spotify', icon: Music },
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'ticketmaster', label: 'Ticketmaster', icon: Ticket },
  { id: 'google-places', label: 'Google Places', icon: MapPin },
] as const;

const APP_VERSION = `v${Constants.expoConfig?.version ?? '0.1.0'}`;

export default function MeScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { user, signOut, token } = useAuth();
  const router = useRouter();
  const network = useNetwork();
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const { showToast, dismissToast } = useFeedback();
  const { count: pendingCount, openDrawer: openPendingDrawer, syncing } =
    useOfflineSync();
  const [warming, setWarming] = React.useState(false);
  const [lastWarmupAt, setLastWarmupAt] = React.useState<number | null>(() =>
    readLastWarmup(queryClient),
  );

  const runSyncNow = React.useCallback(async () => {
    if (warming || !network.online) return;
    setWarming(true);
    const startedToast = showToast({
      kind: 'info',
      text: 'Syncing offline cache…',
      durationMs: 0,
    });
    try {
      const result = await warmCacheForOfflineUse({
        client: utils.client,
        queryClient,
      });
      setLastWarmupAt(result.finishedAt);
      showToast({
        kind: result.failed === 0 ? 'success' : 'info',
        text:
          result.failed === 0
            ? 'Offline cache ready'
            : `Synced with ${result.failed} failure${result.failed === 1 ? '' : 's'}`,
      });
    } catch (err) {
      showToast({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setWarming(false);
      // The "syncing" toast was sticky (durationMs=0); dismiss it explicitly
      // so only the success/error toast remains.
      dismissToast(startedToast);
    }
  }, [warming, network.online, showToast, dismissToast, utils.client, queryClient]);

  // Only call the prefs query once the user has a session; the query is
  // protected and would 401 anonymously. The Me tab only renders behind
  // the auth gate so `token` is normally truthy here.
  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    enabled: Boolean(token),
  });

  const onSignOut = React.useCallback(() => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await signOut();
            router.replace('/(auth)/signin');
          })();
        },
      },
    ]);
  }, [signOut, router]);

  const initial =
    user?.name?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    '?';
  const displayName = user?.name ?? user?.email ?? 'Signed in';
  const subtitle = user?.email ? `signed in · ${user.email}` : 'signed in';

  // Take the first region as the effective default. The prefs router models
  // regions as an unordered list (no `isDefault` flag) — picking the first
  // matches the design's single-row "Default region" treatment.
  const defaultRegion = prefsQuery.data?.regions?.[0];

  const back = (
    <Pressable
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <ChevronLeft size={24} color={colors.ink} strokeWidth={2} />
    </Pressable>
  );

  return (
    <ScreenWrapper title="Me" eyebrow="ACCOUNT · SETTINGS" leading={back} large>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.userRow}>
          <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
            <Text style={[styles.avatarText, { color: colors.accentText }]}>{initial}</Text>
          </View>
          <View style={styles.userText}>
            <Text style={[styles.userName, { color: colors.ink }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Text style={[styles.userSub, { color: colors.muted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </View>

        {/* INTEGRATIONS */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>INTEGRATIONS</Text>
        <View
          style={[
            styles.card,
            styles.cardNoPad,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          {INTEGRATIONS.map((row, i) => (
            <IntegrationRowView
              key={row.id}
              row={row}
              isLast={i === INTEGRATIONS.length - 1}
              onPress={() => router.push(`/integrations/${row.id}`)}
            />
          ))}
        </View>

        {/* REGION */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>REGION</Text>
        <View
          style={[
            styles.card,
            styles.cardNoPad,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Pressable
            onPress={() => router.push('/regions')}
            accessibilityRole="button"
            accessibilityLabel="Edit regions"
            testID="me-regions-row"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <MapPin size={18} color={colors.muted} strokeWidth={2} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.ink }]}>Region</Text>
              <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                {prefsQuery.isLoading
                  ? 'Loading…'
                  : defaultRegion
                    ? regionRowSubtitle(prefsQuery.data?.regions ?? [], defaultRegion)
                    : 'Tap to add your first region'}
              </Text>
              <Text style={[styles.rowSub, { color: colors.faint, marginTop: 2 }]} numberOfLines={1}>
                powers your daily email
              </Text>
            </View>
            <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
          </Pressable>
        </View>

        {/* SYNC */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>SYNC</Text>
        <View
          style={[
            styles.card,
            styles.cardNoPad,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Pressable
            onPress={openPendingDrawer}
            accessibilityRole="button"
            accessibilityLabel="Open pending changes"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <CloudUpload size={18} color={colors.muted} strokeWidth={2} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.ink }]}>
                {pendingCount === 0
                  ? 'No changes pending'
                  : `${pendingCount} change${pendingCount === 1 ? '' : 's'} pending`}
              </Text>
              <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                {syncing
                  ? 'Syncing now…'
                  : pendingCount === 0
                    ? 'All caught up'
                    : 'Tap to review or retry'}
              </Text>
            </View>
            <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
          </Pressable>
          <Pressable
            onPress={() => {
              void runSyncNow();
            }}
            disabled={warming || !network.online}
            accessibilityRole="button"
            accessibilityLabel="Sync offline cache"
            testID="me-sync-now"
            style={({ pressed }) => [
              styles.row,
              {
                borderTopColor: colors.rule,
                borderTopWidth: StyleSheet.hairlineWidth,
                opacity: warming || !network.online ? 0.5 : 1,
              },
              pressed && styles.pressed,
            ]}
          >
            <RefreshCw size={18} color={colors.muted} strokeWidth={2} />
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.ink }]}>
                {warming ? 'Syncing now…' : 'Sync offline cache'}
              </Text>
              <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                {!network.online
                  ? 'Connect to a network to sync'
                  : lastWarmupAt
                    ? `Last synced ${formatRelative(new Date(lastWarmupAt))}`
                    : 'Never synced'}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* APPEARANCE */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>APPEARANCE</Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Text style={[styles.cardEyebrow, { color: colors.muted }]}>THEME</Text>
          <ThemePreferenceSelector />
          <View style={styles.cardSpacer} />
          <Text style={[styles.cardEyebrow, { color: colors.muted }]}>DENSITY</Text>
          <DensitySelector />
        </View>

        {/* ACCOUNT */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>ACCOUNT</Text>
        <View
          style={[
            styles.card,
            styles.cardNoPad,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Pressable
            onPress={onSignOut}
            style={({ pressed }) => [styles.signOutRow, pressed && styles.pressed]}
          >
            <Text style={[styles.signOutLabel, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        </View>

        {/* ADMIN — operator-only; AdminSection self-gates on admin.amIAdmin
            and renders nothing for non-admins. */}
        <AdminSection />

        <Text style={[styles.footer, { color: colors.faint }]}>
          SHOWBOOK · {APP_VERSION}
        </Text>
      </ScrollView>
    </ScreenWrapper>
  );
}

function IntegrationRowView({
  row,
  isLast,
  onPress,
}: {
  row: IntegrationRow;
  isLast: boolean;
  onPress: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const Icon = row.icon;
  const status = useIntegrationStatus(row.id);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Manage ${row.label} integration`}
      testID={`integration-row-${row.id}`}
      style={({ pressed }) => [
        styles.row,
        !isLast && { borderBottomColor: colors.rule, borderBottomWidth: StyleSheet.hairlineWidth },
        pressed && styles.pressed,
      ]}
    >
      <Icon size={18} color={colors.muted} strokeWidth={2} />
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.ink }]}>{row.label}</Text>
        <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
          {status}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
    </Pressable>
  );
}

/**
 * Per-row status text.
 *  - Spotify is a per-user OAuth integration with live connection state.
 *  - Ticketmaster + Google Places are app-wide API keys baked into the
 *    Showbook backend (`TICKETMASTER_API_KEY` / `GOOGLE_PLACES_API_KEY`),
 *    so they're effectively always-on for every signed-in user. The
 *    `[id].tsx` detail screen explains this when tapped.
 *  - Gmail is a per-user OAuth flow on web; the mobile OAuth bridge
 *    isn't wired up yet, so it stays on the placeholder.
 */
function useIntegrationStatus(id: IntegrationRow['id']): string {
  // The hook always renders — we read it unconditionally and ignore the
  // value for non-Spotify rows. Cheap (cached connectionStatus query).
  const spotify = useSpotifyConnection();
  if (id === 'ticketmaster' || id === 'google-places') return 'Connected · Built-in';
  if (id !== 'spotify') return 'Not connected';
  if (spotify.connection.status === 'loading') return 'Checking…';
  if (spotify.connection.status === 'disconnected') return 'Not connected';
  return spotify.connection.displayName
    ? `Connected · ${spotify.connection.displayName}`
    : 'Connected';
}

/**
 * Subtitle for the Region row. With one region we show the dot-separated
 * "City · Radius" pattern from the web Preferences page; with multiple
 * we show the default-region detail plus a "+N more" hint so the user
 * knows the row is plural.
 */
function regionRowSubtitle(
  regions: readonly { cityName: string; radiusMiles: number }[],
  primary: { cityName: string; radiusMiles: number },
): string {
  const head = `${primary.cityName} · ${primary.radiusMiles}mi`;
  if (regions.length <= 1) return head;
  return `${head} · +${regions.length - 1} more`;
}

function ThemePreferenceSelector(): React.JSX.Element {
  const { preference, setPreference } = useTheme();
  return (
    <SegmentedControl<ThemePreference>
      options={[
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ]}
      value={preference}
      onChange={setPreference}
    />
  );
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DensitySelector(): React.JSX.Element {
  const { density, setDensity } = useTheme();
  return (
    <SegmentedControl<Density>
      options={[
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'compact', label: 'Compact' },
      ]}
      value={density}
      onChange={setDensity}
    />
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 48,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: RADII.pill,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: 'Geist Sans 700',
    fontSize: 22,
  },
  userText: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontFamily: 'Geist Sans 700',
    fontSize: 17,
  },
  userSub: {
    fontFamily: 'Geist Sans 400',
    fontSize: 12,
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: RADII.lg,
    borderWidth: 1,
    padding: 16,
  },
  cardNoPad: {
    padding: 0,
    overflow: 'hidden',
  },
  cardEyebrow: {
    fontFamily: 'Geist Sans 600',
    fontSize: 11,
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cardSpacer: {
    height: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 14,
  },
  rowSub: {
    fontFamily: 'Geist Sans 400',
    fontSize: 11,
    marginTop: 2,
  },
  signOutRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  signOutLabel: {
    fontFamily: 'Geist Sans 500',
    fontSize: 14,
  },
  pressed: {
    opacity: 0.85,
  },
  footer: {
    fontFamily: 'Geist Sans 600',
    fontSize: 10.5,
    letterSpacing: 1.05,
    textAlign: 'center',
    paddingTop: 24,
  },
});
