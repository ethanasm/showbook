/**
 * Me tab — account, theme preference, sign out.
 *
 * The only fully wired tab in M1. Layout follows the design source
 * (design_handoff_showbook_mobile/screens/me-and-modals.jsx
 * PreferencesScreen):
 *   - User card row (avatar circle + name + signed-in email)
 *   - APPEARANCE section: Theme segmented control (Light / Dark / System)
 *   - ACCOUNT section: Sign out (destructive, red)
 *   - SHOWBOOK · vX footer
 *
 * Other rows from the design (Integrations, Region, Notifications, Export)
 * land in later milestones — their network-side wiring isn't built yet.
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
import { TopBar } from '../../components/TopBar';
import { useTheme, type ThemePreference } from '../../lib/theme';
import { useAuth } from '../../lib/auth';

export default function MeScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { user, signOut } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

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

  // Avatar initial: prefer name, fall back to email, otherwise '?'
  const initial =
    user?.name?.[0]?.toUpperCase() ??
    user?.email?.[0]?.toUpperCase() ??
    '?';
  const displayName = user?.name ?? user?.email ?? 'Signed in';
  const subtitle = user?.email ? `signed in · ${user.email}` : 'signed in';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar title="Me" eyebrow="ACCOUNT · SETTINGS" large />

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* User card row */}
        <View style={styles.userRow}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: colors.accent },
            ]}
          >
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

        {/* APPEARANCE section */}
        <Text style={[styles.sectionLabel, { color: colors.muted }]}>APPEARANCE</Text>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.surface, borderColor: colors.rule },
          ]}
        >
          <Text style={[styles.cardEyebrow, { color: colors.muted }]}>THEME</Text>
          <ThemePreferenceSelector />
        </View>

        {/* ACCOUNT section */}
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
            style={({ pressed }) => [
              styles.signOutRow,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.signOutLabel, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        </View>

        {/* Footer */}
        <Text style={[styles.footer, { color: colors.faint }]}>
          SHOWBOOK · v0.1 · M1
        </Text>
      </ScrollView>
    </View>
  );
}

/**
 * Local segmented control for theme preference. Three options matching
 * ThemePreference: light / dark / system. The active segment uses the
 * surface color over a rule-track background, mirroring the design
 * SegmentedControlMobile.
 */
function ThemePreferenceSelector(): React.JSX.Element {
  const { tokens, preference, setPreference } = useTheme();
  const { colors } = tokens;
  const options: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
  ];
  return (
    <View style={[styles.segmented, { backgroundColor: colors.rule }]}>
      {options.map((opt) => {
        const isActive = preference === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => setPreference(opt.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            style={({ pressed }) => [
              styles.segment,
              isActive && { backgroundColor: colors.surface },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.segmentLabel,
                {
                  color: isActive ? colors.ink : colors.muted,
                  fontWeight: isActive ? '600' : '400',
                },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
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
    letterSpacing: 1.05, // 0.1em on 10.5pt
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
    letterSpacing: 0.88, // ~0.08em on 11pt
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: 8,
    padding: 2,
  },
  segment: {
    flex: 1,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
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
