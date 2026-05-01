/**
 * Pure token utilities — no React Native or Expo imports.
 * Importable in Node.js tests without a RN environment.
 */

import { KIND_COLORS, type Kind } from '@showbook/shared';

export type { Kind };
export type ThemeMode = 'light' | 'dark';

/**
 * Resolve the kind color for a given display mode.
 * Pure function — safe to import in unit tests.
 */
export function getKindColor(kind: Kind, mode: ThemeMode): string {
  return KIND_COLORS[kind][mode];
}

/** Design token color values — exported for test assertions */
export const DARK_COLORS = {
  bg: '#0C0C0C',
  surface: '#141414',
  surfaceRaised: '#1A1A1A',
  ink: '#F5F5F3',
  muted: 'rgba(245,245,243,0.55)',
  faint: 'rgba(245,245,243,0.32)',
  rule: 'rgba(245,245,243,0.10)',
  ruleStrong: 'rgba(245,245,243,0.22)',
  accent: '#FFD166',
  accentFaded: 'rgba(255,209,102,0.14)',
  accentText: '#0C0C0C',
} as const;

export const LIGHT_COLORS = {
  bg: '#FAFAF8',
  surface: '#FFFFFF',
  surfaceRaised: '#F0F0EE',
  ink: '#0B0B0A',
  muted: 'rgba(11,11,10,0.55)',
  faint: 'rgba(11,11,10,0.32)',
  rule: 'rgba(11,11,10,0.10)',
  ruleStrong: 'rgba(11,11,10,0.22)',
  accent: '#E5A800',
  accentFaded: 'rgba(229,168,0,0.14)',
  accentText: '#FFFFFF',
} as const;

/** Spacing scale (4pt grid) */
export const SPACING = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

/** Border radii */
export const RADII = { none: 0, sm: 4, md: 8, lg: 12, xl: 16, pill: 999 } as const;

/**
 * Type ramp: absolute lineHeight (fontSize × multiplier, rounded).
 * letterSpacing in pixels (RN); caption = 0.08em × 11.5px ≈ 0.9px.
 */
export const TYPE_RAMP = {
  heroTitle: { fontSize: 32, fontWeight: '700' as const, fontFamily: 'Georgia', lineHeight: 35 },
  screenTitle: { fontSize: 24, fontWeight: '700' as const, fontFamily: 'Geist Sans', lineHeight: 29 },
  sectionTitle: { fontSize: 18, fontWeight: '600' as const, fontFamily: 'Geist Sans', lineHeight: 23 },
  body: { fontSize: 15, fontWeight: '400' as const, fontFamily: 'Geist Sans', lineHeight: 23 },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, fontFamily: 'Geist Sans', lineHeight: 18 },
  caption: {
    fontSize: 11.5,
    fontWeight: '500' as const,
    fontFamily: 'Geist Sans',
    lineHeight: 15,
    letterSpacing: 0.9,
    textTransform: 'uppercase' as const,
  },
  headliner: { fontSize: 22, fontWeight: '700' as const, fontFamily: 'Georgia', lineHeight: 25 },
  stat: { fontSize: 28, fontWeight: '700' as const, fontFamily: 'Geist Sans', lineHeight: 31 },
} as const;
