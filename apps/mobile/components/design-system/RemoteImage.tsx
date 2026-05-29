/**
 * RemoteImage — image primitive with a kind-coloured monogram fallback.
 * Mirrors the web `apps/web/components/design-system/RemoteImage.tsx`:
 *
 *   - thumb (32×32 circular), card (96 wide, 12 radius), hero (full-width
 *     configurable aspect).
 *   - When `uri` is null or the image fails to load, render a monogram
 *     fallback: the first letter of `name`, on a kind-coloured radial
 *     gradient.
 *   - Hero crop bias upper-third (matches `object-position: center 30%`
 *     on the web) so band/artist photos don't behead the subject.
 *
 * Implementation: uses `expo-image` for the photo layer (built-in
 * crossfade via `transition`) and `react-native-svg` for the gradient
 * fallback so we don't pull in another gradient lib just for this.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme, type Kind } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

type Size = 'thumb' | 'card' | 'hero' | 'custom';
type Aspect = '1/1' | '3/2' | '16/9';

export interface RemoteImageProps {
  uri: string | null | undefined;
  name: string;
  /** Optional kind to colour the monogram fallback. Defaults to "concert". */
  kind?: Kind;
  size?: Size;
  aspect?: Aspect;
  /** Required when size === "custom". */
  width?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
  /** Accessible label, defaults to the name. */
  accessibilityLabel?: string;
  /**
   * Optional HTTP headers forwarded to expo-image for the upstream fetch.
   * Used to attach `Authorization: Bearer <jwt>` when proxying through
   * session-gated routes like /api/venue-photo/<id>.
   */
  headers?: Record<string, string>;
}

function aspectRatio(aspect: Aspect): number {
  if (aspect === '1/1') return 1;
  if (aspect === '3/2') return 3 / 2;
  return 16 / 9;
}

function initialOf(name: string): string {
  const ch = name.trim()[0];
  return ch ? ch.toUpperCase() : '?';
}

export function RemoteImage({
  uri,
  name,
  kind = 'concert',
  size = 'card',
  aspect = '1/1',
  width,
  height,
  style,
  accessibilityLabel,
  headers,
}: RemoteImageProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const kindColor = tokens.kindColor(kind);
  const [failed, setFailed] = useState(false);

  // Sizing rules per variant.
  let frameStyle: ViewStyle;
  let monogramFontSize: number;
  let borderRadius: number;
  if (size === 'thumb') {
    frameStyle = { width: 32, height: 32 };
    monogramFontSize = 13;
    borderRadius = RADII.pill;
  } else if (size === 'card') {
    const w = width ?? 96;
    frameStyle = { width: w, aspectRatio: aspectRatio(aspect) };
    monogramFontSize = 28;
    borderRadius = RADII.lg;
  } else if (size === 'hero') {
    frameStyle = { width: '100%', aspectRatio: aspectRatio(aspect) };
    monogramFontSize = 64;
    borderRadius = 0;
  } else {
    frameStyle = {
      width: width ?? '100%',
      height: height,
      aspectRatio: height === undefined ? aspectRatio(aspect) : undefined,
    };
    monogramFontSize = 32;
    borderRadius = RADII.lg;
  }

  const showFallback = !uri || failed;

  // For hero crops, bias the focal point to the upper third — matches the
  // web object-position: center 30% rule. expo-image's contentPosition
  // takes {top, left} as percent strings.
  const contentPosition =
    size === 'hero'
      ? ({ top: '30%', left: '50%' } as const)
      : undefined;

  return (
    <View
      style={[
        styles.frame,
        frameStyle,
        {
          borderRadius,
          borderColor: colors.rule,
          backgroundColor: colors.surfaceRaised,
        },
        style,
      ]}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? name}
    >
      {/* Monogram layer is always present underneath; the image overlays
          it. When the image loads, expo-image fades it in over the
          monogram, matching the web behaviour. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <RadialGradient id="monoGrad" cx="28%" cy="18%" rx="80%" ry="80%">
              <Stop offset="0%" stopColor={kindColor} stopOpacity="0.36" />
              <Stop offset="60%" stopColor={kindColor} stopOpacity="0.10" />
              <Stop offset="100%" stopColor={kindColor} stopOpacity="0.05" />
            </RadialGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#monoGrad)" />
        </Svg>
        {showFallback ? (
          <View style={StyleSheet.absoluteFill}>
            <View style={styles.monogramCenter}>
              <Text
                style={[
                  styles.monogram,
                  { fontSize: monogramFontSize, color: colors.ink },
                ]}
                allowFontScaling={false}
              >
                {initialOf(name)}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      {uri && !failed ? (
        <Image
          source={{ uri, headers }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition={contentPosition}
          transition={200}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  monogramCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogram: {
    fontFamily: 'Geist Sans 700',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
});
