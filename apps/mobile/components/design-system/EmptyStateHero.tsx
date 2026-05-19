/**
 * EmptyStateHero — full-bleed editorial empty state with a glow backdrop,
 * gradient-emphasis title, kind chips, and the breathing StackedCards
 * decoration. Mirrors the web `apps/web/components/design-system/
 * EmptyState.tsx`.
 *
 * Use this on whole-screen empty states (no shows yet, no artists yet,
 * no discover queue). For inline empties (no results inside a section),
 * keep the compact `components/EmptyState.tsx` — it stays as-is.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../lib/theme';
import { RADII } from '../../lib/theme-utils';
import { Eyebrow } from './Eyebrow';
import { GlowBackdrop } from './GlowBackdrop';
import { GradientEmphasis } from './GradientEmphasis';
import { KindChip } from './KindChip';
import { StackedCards, type StackedCardItem } from './StackedCards';

export type EmptyHeroKind = 'shows' | 'venues' | 'artists' | 'discover' | 'map';

const EYEBROWS: Record<EmptyHeroKind, string> = {
  shows: 'YOUR LIVE-SHOW LOG',
  venues: 'VENUES FROM YOUR SHOWS',
  artists: 'ARTISTS FROM YOUR SHOWS AND FOLLOWS',
  discover: 'DISCOVERY QUEUE',
  map: 'GEOGRAPHIC VIEW',
};

interface EmptyStateHeroProps {
  kind: EmptyHeroKind;
  title: string;
  body: string;
  /** Optional primary CTA — renders as a pill button under the chips. */
  action?: {
    label: string;
    onPress: () => void;
  };
  /** Optional secondary CTA — quieter ghost button next to the primary. */
  secondaryAction?: {
    label: string;
    onPress: () => void;
  };
  /** Override the stacked-card sample. Use the four default tickets if omitted. */
  cards?: StackedCardItem[];
}

function splitLastWord(text: string): { head: string; tail: string } {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) return { head: '', tail: trimmed };
  const tail = parts.pop() as string;
  return { head: parts.join(' ') + ' ', tail };
}

export function EmptyStateHero({
  kind,
  title,
  body,
  action,
  secondaryAction,
  cards,
}: EmptyStateHeroProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { head, tail } = splitLastWord(title);

  return (
    <View
      testID="empty-state-hero"
      style={[styles.frame, { borderColor: colors.rule, backgroundColor: colors.surface }]}
    >
      <GlowBackdrop />
      <View style={styles.content}>
        <Eyebrow>{EYEBROWS[kind]}</Eyebrow>

        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.ink }]}>
            {head ? <Text>{head}</Text> : null}
            <GradientEmphasis style={[styles.title, { color: colors.accent }]}>
              {tail}
            </GradientEmphasis>
          </Text>
        </View>

        <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>

        <View style={styles.chipRow}>
          <KindChip kind="concert" label="Concerts" />
          <KindChip kind="theatre" label="Theatre" />
          <KindChip kind="comedy" label="Comedy" />
          <KindChip kind="festival" label="Festivals" />
        </View>

        {(action || secondaryAction) && (
          <View style={styles.actionRow}>
            {action ? (
              <Pressable
                onPress={action.onPress}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.accent,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text style={[styles.primaryBtnLabel, { color: colors.accentText }]}>
                  {action.label}
                </Text>
              </Pressable>
            ) : null}
            {secondaryAction ? (
              <Pressable
                onPress={secondaryAction.onPress}
                accessibilityRole="button"
                accessibilityLabel={secondaryAction.label}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  {
                    borderColor: colors.ruleStrong,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.secondaryBtnLabel, { color: colors.ink }]}>
                  {secondaryAction.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.visual} pointerEvents="none">
        <StackedCards items={cards} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'relative',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 22,
    gap: 26,
    minHeight: 480,
  },
  content: {
    gap: 14,
    alignItems: 'flex-start',
  },
  titleRow: {
    marginTop: 2,
  },
  title: {
    fontFamily: 'Georgia',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
    letterSpacing: -0.4,
    maxWidth: 320,
  },
  body: {
    fontFamily: 'Geist Sans',
    fontSize: 14.5,
    lineHeight: 21,
    maxWidth: 340,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  primaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: RADII.pill,
  },
  primaryBtnLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: RADII.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '500',
  },
  visual: {
    paddingTop: 6,
    alignItems: 'stretch',
  },
});
