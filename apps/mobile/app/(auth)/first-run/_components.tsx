/**
 * Shared layout for the four permission steps.
 *
 * Top: dot/bar progress indicator + Skip button.
 * Center: 96x96 rounded-square icon, eyebrow, hero title, body, optional
 *   illustration / footer slot.
 * Bottom: primary CTA (accent) and secondary text button.
 */

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../../lib/theme';

export interface FirstRunStepProps {
  step: number; // 1-based step index among `total`
  total: number;
  eyebrow: string;
  /** Hero title — accept a string or a React node so callers can color the accent span. */
  title: React.ReactNode;
  body: string;
  /** Lucide icon component or an explicit illustration node. */
  icon?: React.ReactNode;
  iconBg?: string;
  /** Replaces the default icon block when provided (e.g. a stylized illustration). */
  illustration?: React.ReactNode;
  /** Optional footer below the body (e.g. tag chips). */
  footer?: React.ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel: string;
  onSecondary: () => void;
  /** Disable both buttons while an OS prompt is in flight. */
  pending?: boolean;
}

export function FirstRunStep({
  step,
  total,
  eyebrow,
  title,
  body,
  icon,
  iconBg,
  illustration,
  footer,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  pending = false,
}: FirstRunStepProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {/* Top: progress dots + Skip */}
        <View style={styles.topBar}>
          <View style={styles.progressRow}>
            {Array.from({ length: total }).map((_, i) => (
              <View
                key={i}
                style={[
                  styles.progressTick,
                  {
                    width: i < step ? 22 : 8,
                    backgroundColor: i < step ? colors.accent : colors.rule,
                  },
                ]}
              />
            ))}
          </View>
          <Pressable onPress={onSecondary} disabled={pending} hitSlop={12}>
            <Text style={[styles.skipText, { color: colors.faint }]}>Skip</Text>
          </Pressable>
        </View>

        {/* Center: visual + copy */}
        <View style={styles.center}>
          {illustration ? (
            illustration
          ) : (
            <View
              style={[
                styles.iconBlock,
                {
                  backgroundColor: iconBg ?? colors.accentFaded,
                  borderColor: colors.rule,
                },
              ]}
            >
              {icon}
            </View>
          )}
          <View style={styles.titleBlock}>
            <Text style={[styles.eyebrow, { color: colors.accent }]}>{eyebrow}</Text>
            {typeof title === 'string' ? (
              <Text style={[styles.title, { color: colors.ink }]}>{title}</Text>
            ) : (
              title
            )}
          </View>
          <Text style={[styles.body, { color: colors.muted }]}>{body}</Text>
          {footer}
        </View>

        {/* Bottom: CTAs */}
        <View style={styles.bottomBar}>
          <Pressable
            onPress={onPrimary}
            disabled={pending}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: colors.accent },
              (pressed || pending) && styles.pressed,
            ]}
          >
            <Text style={[styles.primaryLabel, { color: colors.accentText }]}>{primaryLabel}</Text>
          </Pressable>
          <Pressable
            onPress={onSecondary}
            disabled={pending}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          >
            <Text style={[styles.secondaryLabel, { color: colors.muted }]}>{secondaryLabel}</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

/**
 * Shared hero-title style — exported so callers can render a Text with an
 * accent-colored span (e.g. <Text>Don't miss the <Text color=accent>on-sale.</Text></Text>).
 */
export const heroTitleStyle = {
  fontFamily: 'Geist Sans',
  fontSize: 30,
  fontWeight: '700' as const,
  lineHeight: 33,
  letterSpacing: -0.3,
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 28,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressRow: {
    flexDirection: 'row',
    gap: 4,
  },
  progressTick: {
    height: 4,
    borderRadius: 2,
  },
  skipText: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingVertical: 20,
  },
  iconBlock: {
    width: 96,
    height: 96,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: {
    alignItems: 'center',
    gap: 8,
  },
  eyebrow: {
    fontFamily: 'Geist Sans',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.54, // 0.14em on 11pt
    textTransform: 'uppercase',
  },
  title: heroTitleStyle,
  body: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '400',
    lineHeight: 22,
    textAlign: 'center',
    maxWidth: 320,
  },
  bottomBar: {
    gap: 8,
  },
  primary: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 14,
    fontWeight: '700',
  },
  secondary: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 13,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.85,
  },
});
