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
 *
 * Falls back to the `unknown` swatch for any kind not in KIND_COLORS.
 * The discoverable map feed plumbs `kind` straight from the DB enum, so a
 * value the current bundle doesn't know about (e.g. a legacy `sports` row
 * that predates the kind's removal, or a future kind shipped server-first)
 * must degrade to a neutral pin instead of throwing — an unguarded
 * `KIND_COLORS[kind][mode]` would otherwise crash the Map tab when the
 * Discoverable layer renders such a row. Mirrors the web map's
 * `KIND_COLORS_HEX[kind] ?? fallback` guard.
 */
export function getKindColor(kind: Kind | string, mode: ThemeMode): string {
  const swatch = KIND_COLORS[kind as Kind] ?? KIND_COLORS.unknown;
  return swatch[mode];
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
  danger: '#E63946',
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
  danger: '#D42F3A',
} as const;

/** Spacing scale (4pt grid) */
export const SPACING = [0, 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64] as const;

/** Border radii */
export const RADII = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, pill: 999 } as const;

/**
 * Type ramp: absolute lineHeight (fontSize × multiplier, rounded).
 * letterSpacing in pixels (RN); caption = 0.08em × 11.5px ≈ 0.9px.
 */
export const TYPE_RAMP = {
  heroTitle: { fontSize: 32, fontWeight: '700' as const, fontFamily: 'Fraunces', lineHeight: 35 },
  screenTitle: { fontSize: 24, fontFamily: 'Geist Sans 700', lineHeight: 29 },
  sectionTitle: { fontSize: 18, fontFamily: 'Geist Sans 600', lineHeight: 23 },
  body: { fontSize: 15, fontFamily: 'Geist Sans 400', lineHeight: 23 },
  bodySmall: { fontSize: 13, fontFamily: 'Geist Sans 400', lineHeight: 18 },
  caption: {
    fontSize: 11.5,
    fontFamily: 'Geist Sans 500',
    lineHeight: 15,
    letterSpacing: 0.9,
    textTransform: 'uppercase' as const,
  },
  headliner: { fontSize: 22, fontWeight: '700' as const, fontFamily: 'Fraunces', lineHeight: 25 },
  stat: { fontSize: 28, fontFamily: 'Geist Sans 700', lineHeight: 31 },
} as const;
