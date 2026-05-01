/**
 * Sign-in screen.
 *
 * Layout (top → bottom):
 *   - "Now playing · your shows" eyebrow with accent dot
 *   - 4 sample peek cards (concert/theatre/comedy/festival) to give a sense
 *     of what the app does without showing real data
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
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth';
import { KindBadge } from '../../components/KindBadge';
import type { Kind } from '../../lib/theme';
import { RADII } from '../../lib/theme-utils';

interface PeekCardData {
  kind: Kind;
  state: 'ticketed' | 'watching' | 'past';
  d: string;
  m: string;
  h: string;
  v: string;
  tag?: string;
}

const SAMPLE_CARDS: PeekCardData[] = [
  { kind: 'concert', state: 'ticketed', d: '14', m: 'MAY', h: 'Phoebe Bridgers', v: 'Forest Hills · Queens' },
  { kind: 'theatre', state: 'watching', d: '02', m: 'JUN', h: 'Hamlet', v: 'Royal Shakespeare · Stratford' },
  { kind: 'comedy', state: 'past', d: '21', m: 'MAR', h: 'John Mulaney', v: 'Beacon Theatre · NYC', tag: 'Seen' },
  { kind: 'festival', state: 'watching', d: '11', m: 'JUL', h: 'Pitchfork Music Festival', v: 'Union Park · Chicago' },
];

export default function SignInScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { signIn, isSigningIn, error } = useAuth();

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

        {/* Sample cards block */}
        <View style={styles.cardsBlock}>
          {SAMPLE_CARDS.map((card) => (
            <SamplePeekCard key={card.h} {...card} />
          ))}
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

function SamplePeekCard({ kind, state, d, m, h, v, tag }: PeekCardData): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const kc = tokens.kindColor(kind);
  const bar =
    state === 'ticketed' ? colors.accent : state === 'watching' ? kc : colors.rule;
  const isTicketed = state === 'ticketed';
  const chipBg = isTicketed ? colors.accent : 'transparent';
  const chipColor = isTicketed ? colors.accentText : colors.ink;
  const chipBorder = isTicketed ? 'transparent' : colors.ruleStrong;
  const chipLabel = tag ?? (state === 'ticketed' ? 'TICKETED' : 'WATCHING');

  return (
    <View
      style={[
        peekStyles.card,
        { backgroundColor: colors.surface, borderLeftColor: bar },
      ]}
    >
      <View style={peekStyles.dateBlock}>
        <Text style={[peekStyles.day, { color: colors.ink }]}>{d}</Text>
        <Text style={[peekStyles.month, { color: colors.muted }]}>{m}</Text>
      </View>
      <View style={peekStyles.body}>
        <Text style={[peekStyles.headliner, { color: colors.ink }]} numberOfLines={1}>
          {h}
        </Text>
        <Text style={[peekStyles.venue, { color: colors.muted }]} numberOfLines={1}>
          {v}
        </Text>
      </View>
      <View
        style={[
          peekStyles.chip,
          {
            backgroundColor: chipBg,
            borderColor: chipBorder,
            borderWidth: isTicketed ? 0 : 1,
          },
        ]}
      >
        <Text style={[peekStyles.chipLabel, { color: chipColor }]}>{chipLabel}</Text>
      </View>
    </View>
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
    letterSpacing: 1.05, // 0.1em on 10.5pt
    textTransform: 'uppercase',
  },
  cardsBlock: {
    gap: 12,
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
    borderRadius: 12,
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

const peekStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  dateBlock: {
    minWidth: 32,
    alignItems: 'center',
  },
  day: {
    fontFamily: 'Geist Sans',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 18,
  },
  month: {
    fontFamily: 'Geist Sans',
    fontSize: 9,
    fontWeight: '500',
    letterSpacing: 0.45,
    marginTop: 2,
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  headliner: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  venue: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '400',
    marginTop: 1,
  },
  chip: {
    borderRadius: RADII.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  chipLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.54,
  },
});
