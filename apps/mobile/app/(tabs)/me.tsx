/**
 * Me tab v2 — account, integrations, region, density/theme, activity, sign-out.
 *
 * Layout follows design/hifi/prefs.jsx (PrefsMobile) within the limits of
 * what M2 actually exposes:
 *   - User card row (avatar circle + name + signed-in email)
 *   - INTEGRATIONS section: Gmail / Ticketmaster / Google Places — display
 *     only for M2. Tapping a row pushes /integrations/[id], which renders an
 *     EmptyState ("Coming in M3"). The connect status text is a placeholder
 *     because the prefs router does not yet expose integration state — see
 *     INTEGRATIONS comment below.
 *   - REGION section: shows the user's first saved region from the existing
 *     `preferences.get` query (the prefs router treats regions as a list and
 *     does not name a "default" — we display the first as the effective
 *     default, with a "Not set" affordance otherwise).
 *   - APPEARANCE section: Theme (Light / Dark / System) + Density
 *     (Comfortable / Compact). Density is persisted locally via
 *     useTheme().setDensity (see lib/theme.ts).
 *   - ACTIVITY section: stubbed with EmptyState. There is no `activity.list`
 *     procedure on AppRouter today — see the ACTIVITY comment below for the
 *     missing API contract.
 *   - ACCOUNT section: Sign out (destructive).
 *   - SHOWBOOK · vX footer.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Mail,
  Ticket,
  MapPin,
  ChevronRight,
  Inbox,
} from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { SegmentedControl } from '../../components/SegmentedControl';
import { EmptyState } from '../../components/EmptyState';
import { useTheme, type ThemePreference, type Density } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { trpc } from '../../lib/trpc';

interface IntegrationRow {
  id: 'gmail' | 'ticketmaster' | 'google-places';
  label: string;
  icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
}

// INTEGRATIONS: the prefs router exposes user preferences + saved regions
// but not third-party connection status (no Gmail OAuth tokens, no
// Ticketmaster linkage, no Google Places key state are surfaced via tRPC).
// For M2 we display each integration with a generic "Not connected" hint
// and route the row tap to the M3 manage stub. When the API lands, swap
// the static `status` string for a per-row read of the new procedure.
const INTEGRATIONS: readonly IntegrationRow[] = [
  { id: 'gmail', label: 'Gmail', icon: Mail },
  { id: 'ticketmaster', label: 'Ticketmaster', icon: Ticket },
  { id: 'google-places', label: 'Google Places', icon: MapPin },
] as const;

export default function MeScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { user, signOut, token } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Me" eyebrow="ACCOUNT · SETTINGS" large />

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
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: colors.ink }]}>Default region</Text>
              <Text style={[styles.rowSub, { color: colors.muted }]} numberOfLines={1}>
                {defaultRegion
                  ? `${defaultRegion.cityName} · ${defaultRegion.radiusMiles}mi`
                  : prefsQuery.isLoading
                    ? 'Loading…'
                    : 'Not set'}
              </Text>
            </View>
          </View>
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

        {/* ACTIVITY */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>RECENT ACTIVITY</Text>
        <View
          style={[
            styles.card,
            styles.activityCard,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          {/*
           * ACTIVITY: there is no `activity.list` procedure on AppRouter yet.
           * The intended contract (per the C-5 spec) is a paginated read
           * returning the 5 most recent user-facing events — adds, edits,
           * media tags, follows. When the API lands, replace this stub with
           * a small list view bound to `trpc.activity.list.useQuery({
           * limit: 5 })`.
           */}
          <EmptyState
            icon={<Inbox size={40} color={colors.muted} />}
            title="No activity yet"
            subtitle="Recent adds, edits, and tagged media will show up here."
          />
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

        <Text style={[styles.footer, { color: colors.faint }]}>
          SHOWBOOK · v0.1 · M2
        </Text>
      </ScrollView>
    </View>
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
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Manage ${row.label} integration`}
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
          Not connected
        </Text>
      </View>
      <ChevronRight size={16} color={colors.faint} strokeWidth={2} />
    </Pressable>
  );
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
    paddingBottom: 100,
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
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: 'Geist Sans',
    fontSize: 22,
    fontWeight: '700',
  },
  userText: {
    flex: 1,
    minWidth: 0,
  },
  userName: {
    fontFamily: 'Geist Sans',
    fontSize: 17,
    fontWeight: '700',
  },
  userSub: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  sectionLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  card: {
    marginHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
  },
  cardNoPad: {
    padding: 0,
    overflow: 'hidden',
  },
  cardEyebrow: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.88,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  cardSpacer: {
    height: 16,
  },
  activityCard: {
    padding: 0,
    minHeight: 160,
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
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
  rowSub: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  signOutRow: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  signOutLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.85,
  },
  footer: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textAlign: 'center',
    paddingTop: 24,
  },
});
