/**
 * BrandMark — the gold-ticket Showbook mark, simplified for in-app use.
 *
 * The full master lives at `apps/mobile/assets/icon.png` (with gradient,
 * highlight, and soft drop shadow). This component renders the same
 * silhouette in a flat solid fill — at 20–40 px the gradient is
 * imperceptible and the simplified shape stays crisp.
 *
 * Default `size` is 28 px (the height of the home header wordmark row).
 *
 * The ticket fill uses the active theme's `accent` (warm gold on dark,
 * deeper amber on light). The S stays a fixed deep ink in both modes —
 * the punch-through reads as "you can see the dark canvas through the
 * ticket" on dark, and as a high-contrast cut-out on light. Using the
 * variable `bg` for the S would make it invisible in light mode.
 */

import React from 'react';
import Svg, { G, Path, Text } from 'react-native-svg';
import { useTheme } from '../lib/theme';

export interface BrandMarkProps {
  size?: number;
}

const S_INK = '#0B0B0A';

export function BrandMark({ size = 28 }: BrandMarkProps): React.JSX.Element {
  const { tokens } = useTheme();
  const ticketFill = tokens.colors.accent;

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      accessibilityLabel="Showbook"
    >
      <G originX={32} originY={32} rotation={-6}>
        <Path
          fill={ticketFill}
          fillRule="evenodd"
          d="M 14.5 18 H 49.5 A 3.5 3.5 0 0 1 53 21.5 V 30 A 3.75 3.75 0 0 0 49.25 33.75 A 3.75 3.75 0 0 0 53 37.5 V 42.5 A 3.5 3.5 0 0 1 49.5 46 H 14.5 A 3.5 3.5 0 0 1 11 42.5 V 37.5 A 3.75 3.75 0 0 0 14.75 33.75 A 3.75 3.75 0 0 0 11 30 V 21.5 A 3.5 3.5 0 0 1 14.5 18 Z"
        />
        <Text
          x={32}
          y={41.5}
          fontSize={26}
          fontWeight="900"
          fill={S_INK}
          textAnchor="middle"
          // System sans bold reads as a clean geometric S on iOS + Android.
          // RN-SVG ignores web font stacks beyond the first entry, so we
          // keep it short and let the OS pick its bold sans.
          fontFamily="System"
        >
          S
        </Text>
      </G>
    </Svg>
  );
}
