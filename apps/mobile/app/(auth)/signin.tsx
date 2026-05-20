/**
 * Sign-in screen.
 *
 * Layout (top → bottom):
 *   - "Now playing · your shows" eyebrow with accent dot
 *   - StackedCards (the same crooked-rows decoration used in empty states)
 *     to give a sense of what the app does without showing real data
 *   - Brand block: small `S` accent square logo, eyebrow, hero title with
 *     accent-colored ", worth remembering.", subtitle, kind badges row,
 *     "Sign in with Google" button, and footer fine-print.
 *
 * The Google logo: the design uses a CSS conic-gradient which RN doesn't
 * support. We render a simple grey square with a "G" mark instead — close
 * enough for M1; replaceable with an SVG if a designer pushes back.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { KindBadge } from '../../components/KindBadge';
import { StackedCards } from '../../components/design-system';

export default function SignInScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { signIn, isSigningIn, error, user, isFirstRun } = useAuth();

  if (user) {
    return <Redirect href={isFirstRun ? '/(auth)/first-run/welcome' : '/(tabs)'} />;
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Top eyebrow */}
        <View style={styles.eyebrowRow}>
          <View style={[styles.dot, { backgroundColor: colors.accent }]} />
          <Text style={[styles.eyebrow, { color: colors.muted }]}>NOW PLAYING · YOUR SHOWS</Text>
        </View>

        {/* Crooked stacked sample tickets (matches empty-state treatment) */}
        <View style={styles.cardsBlock}>
          <StackedCards />
        </View>

        {/* Brand + sign-in block */}
        <View style={styles.brandBlock}>
          <View style={[styles.logo, { backgroundColor: colors.accent }]}>
            <Text style={[styles.logoText, { color: colors.accentText }]}>S</Text>
          </View>

          <Text style={[styles.eyebrow, { color: colors.muted }]}>PERSONAL LIVE-SHOW TRACKER</Text>

          <Text style={[styles.heroLine, { color: colors.ink }]}>
            Every show,
            <Text style={{ color: colors.accent }}>{'\n'}worth remembering.</Text>
          </Text>

          <Text style={[styles.subtitle, { color: colors.muted }]}>
            A private logbook for the concerts, plays, sets, and festivals you&apos;ve seen — and the ones still ahead.
          </Text>

          <View style={styles.badgeRow}>
            <KindBadge kind="concert" size="sm" />
            <KindBadge kind="theatre" size="sm" />
            <KindBadge kind="comedy" size="sm" />
            <KindBadge kind="festival" size="sm" />
          </View>

          {error ? (
            <View
              style={[
                styles.errorBanner,
                { backgroundColor: colors.surface, borderColor: colors.ruleStrong },
              ]}
            >
              <Text style={[styles.errorText, { color: colors.ink }]}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={signIn}
            disabled={isSigningIn}
            style={({ pressed }) => [
              styles.signInButton,
              { backgroundColor: colors.surface, borderColor: colors.ruleStrong },
              (pressed || isSigningIn) && styles.pressed,
            ]}
          >
            {isSigningIn ? (
              <ActivityIndicator color={colors.ink} />
            ) : (
              <>
                <View style={[styles.googleLogo, { backgroundColor: colors.surfaceRaised, borderColor: colors.rule }]}>
                  <Text style={[styles.googleLetter, { color: colors.ink }]}>G</Text>
                </View>
                <Text style={[styles.signInLabel, { color: colors.ink }]}>Sign in with Google</Text>
              </>
            )}
          </Pressable>

          <Text style={[styles.footer, { color: colors.faint }]}>
            By continuing you agree to keep things tasteful. We only read your basic Google profile.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 24,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  eyebrow: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
    textTransform: 'uppercase',
  },
  cardsBlock: {
    paddingVertical: 8,
  },
  brandBlock: {
    gap: 16,
    marginTop: 8,
  },
  logo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    fontFamily: 'Geist Sans',
    fontSize: 16,
    fontWeight: '700',
  },
  heroLine: {
    fontFamily: 'Geist Sans',
    fontSize: 32,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.32,
  },
  subtitle: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 20,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  errorBanner: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  signInButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 50,
  },
  pressed: {
    opacity: 0.85,
  },
  googleLogo: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleLetter: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '700',
  },
  signInLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '600',
  },
  footer: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '400',
    lineHeight: 16,
  },
});

