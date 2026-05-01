/**
 * First-run welcome screen — shown once after OAuth completes for a brand
 * new user. Acts as the agenda for the four permission steps that follow.
 *
 * Layout differs from the FirstRunStep template (no progress dots, no
 * Skip button, larger headline), so we inline it here.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Bell, Image as ImageIcon, MapPin, Mail } from 'lucide-react-native';
import { useTheme } from '../../../lib/theme';
import { useAuth } from '../../../lib/auth';

interface AgendaRow {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  label: string;
  sub: string;
}

const AGENDA: AgendaRow[] = [
  { Icon: Bell, label: 'On-sale alerts', sub: '~5 sec' },
  { Icon: ImageIcon, label: 'Photo & video access', sub: '~5 sec' },
  { Icon: MapPin, label: 'Region (for nearby shows)', sub: '~5 sec' },
  { Icon: Mail, label: 'Gmail (optional · skip OK)', sub: '~10 sec' },
];

function firstName(user: { name: string | null; email: string }): string {
  if (user.name) return user.name.split(' ')[0] ?? user.name;
  const local = user.email.split('@')[0] ?? '';
  if (!local) return 'friend';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function initial(user: { name: string | null; email: string }): string {
  return firstName(user).charAt(0).toUpperCase() || '?';
}

export default function FirstRunWelcome(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { user } = useAuth();

  const displayName = user ? firstName(user) : 'there';
  const avatarLetter = user ? initial(user) : 'S';

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.center}>
          {/* Avatar with Google badge */}
          <View style={styles.avatarStack}>
            {user?.image ? (
              <Image source={{ uri: user.image }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                <Text style={[styles.avatarLetter, { color: colors.accentText }]}>{avatarLetter}</Text>
              </View>
            )}
            <View style={[styles.googleBadgeOuter, { backgroundColor: colors.bg }]}>
              <View style={styles.googleBadge}>
                <Text style={styles.googleBadgeLetter}>G</Text>
              </View>
            </View>
          </View>

          <View style={styles.titleBlock}>
            <Text style={[styles.eyebrow, { color: colors.accent }]}>SIGNED IN VIA GOOGLE</Text>
            <Text style={[styles.title, { color: colors.ink }]}>
              Welcome,{'\n'}
              {displayName}.
            </Text>
          </View>

          <Text style={[styles.body, { color: colors.muted }]}>
            Four quick questions and your showbook is ready. Less than 30 seconds.
          </Text>

          <View style={styles.agenda}>
            {AGENDA.map(({ Icon, label, sub }) => (
              <View
                key={label}
                style={[
                  styles.agendaRow,
                  { backgroundColor: colors.surface, borderColor: colors.rule },
                ]}
              >
                <View
                  style={[styles.agendaIcon, { backgroundColor: colors.bg, borderColor: colors.rule }]}
                >
                  <Icon size={14} color={colors.accent} strokeWidth={2} />
                </View>
                <Text style={[styles.agendaLabel, { color: colors.ink }]}>{label}</Text>
                <Text style={[styles.agendaSub, { color: colors.muted }]}>{sub}</Text>
              </View>
            ))}
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/(auth)/first-run/notifications')}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: colors.accent },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.ctaLabel, { color: colors.accentText }]}>Set up showbook</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 28,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
  avatarStack: {
    width: 80,
    height: 80,
    position: 'relative',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontFamily: 'Geist Sans',
    fontSize: 32,
    fontWeight: '700',
  },
  googleBadgeOuter: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    // Google brand white. Intentionally hardcoded — the user identifies
    // this as the Google badge regardless of app theme, so the brand
    // colors don't theme-swap. (Same reasoning for googleBadgeLetter
    // below.)
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBadgeLetter: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '700',
    // Google brand blue (#4285F4). Intentionally hardcoded for brand
    // recognition — not a theme token.
    color: '#4285F4',
  },
  titleBlock: {
    alignItems: 'center',
    gap: 10,
  },
  eyebrow: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.54,
    textTransform: 'uppercase',
  },
  title: {
    fontFamily: 'Geist Sans',
    fontSize: 36,
    fontWeight: '700',
    lineHeight: 38,
    letterSpacing: -0.72,
    textAlign: 'center',
  },
  body: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 300,
  },
  agenda: {
    width: '100%',
    maxWidth: 300,
    gap: 6,
    marginTop: 4,
  },
  agendaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  agendaIcon: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agendaLabel: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
  },
  agendaSub: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '400',
    letterSpacing: 0.6,
  },
  cta: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
  },
});
