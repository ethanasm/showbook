/**
 * Showbook theme module — design token system for the mobile app.
 *
 * Persists user preference via expo-secure-store (overkill for a theme pref,
 * but it's the only persistent K/V installed in M1 — documented choice).
 *
 * Font loading: fontFamily values ('Geist Sans', 'Georgia') are declared here
 * as logical names. Actual font loading via expo-font happens in Task 5/6
 * root layout. React Native falls back to system sans/serif if the font isn't
 * loaded yet.
 *
 * KIND_COLORS is imported from @showbook/shared to avoid duplication.
 * The shared type is `Kind = 'concert' | 'theatre' | 'comedy' | 'festival' | 'sports'`
 * which matches exactly what this module needs.
 *
 * Pure token utilities (getKindColor, color consts, type ramp) live in
 * ./theme-utils.ts so they can be imported in Node.js unit tests without
 * pulling in react-native or expo-secure-store.
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Appearance } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import {
  type Kind,
  type ThemeMode,
  getKindColor,
  DARK_COLORS,
  LIGHT_COLORS,
  SPACING,
  RADII,
  TYPE_RAMP,
} from './theme-utils';
import { type ShowState } from '@showbook/shared';

// Re-export so callers can import from a single mobile path
export type { Kind, ShowState, ThemeMode };
export type ThemePreference = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

const PREF_KEY = 'showbook.theme.preference';
const DENSITY_KEY = 'showbook.theme.density';

// ---------------------------------------------------------------------------
// Token interfaces
// ---------------------------------------------------------------------------

export interface ColorTokens {
  bg: string;
  surface: string;
  surfaceRaised: string;
  ink: string;
  muted: string;
  faint: string;
  rule: string;
  ruleStrong: string;
  accent: string;
  accentFaded: string;
  accentText: string;
  danger: string;
}

export interface TypeStyle {
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700';
  fontFamily: string;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: 'uppercase' | 'capitalize' | 'lowercase' | 'none';
}

export interface Tokens {
  colors: ColorTokens;
  spacing: readonly number[];
  radii: { none: 0; sm: 4; md: 8; lg: 12; xl: 16; pill: 999 };
  type: {
    heroTitle: TypeStyle;
    screenTitle: TypeStyle;
    sectionTitle: TypeStyle;
    body: TypeStyle;
    bodySmall: TypeStyle;
    caption: TypeStyle;
    headliner: TypeStyle;
    stat: TypeStyle;
  };
  kindColor: (kind: Kind) => string;
  kindAccent: (kind: Kind) => string; // alias for kindColor
}

function buildTokens(mode: ThemeMode): Tokens {
  const colors = mode === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const kindColor = (kind: Kind) => getKindColor(kind, mode);
  return {
    colors,
    spacing: SPACING,
    radii: RADII,
    type: TYPE_RAMP,
    kindColor,
    kindAccent: kindColor, // alias
  };
}

const DARK_TOKENS = buildTokens('dark');
const LIGHT_TOKENS = buildTokens('light');

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ThemeContextValue {
  mode: ThemeMode;
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  density: Density;
  setDensity: (d: Density) => void;
  tokens: Tokens;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  preference: 'system',
  setPreference: () => undefined,
  density: 'comfortable',
  setDensity: () => undefined,
  tokens: DARK_TOKENS,
});

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [density, setDensityState] = useState<Density>('comfortable');
  const [deviceScheme, setDeviceScheme] = useState<'light' | 'dark'>(
    Appearance.getColorScheme() === 'light' ? 'light' : 'dark',
  );

  // Load persisted preference on mount
  useEffect(() => {
    SecureStore.getItemAsync(PREF_KEY)
      .then((stored) => {
        if (stored === 'light' || stored === 'dark' || stored === 'system') {
          setPreferenceState(stored);
        }
      })
      .catch(() => {
        // If read fails, stay with 'system' default
      });
    SecureStore.getItemAsync(DENSITY_KEY)
      .then((stored) => {
        if (stored === 'comfortable' || stored === 'compact') {
          setDensityState(stored);
        }
      })
      .catch(() => {
        // Stay with 'comfortable' default on read failure
      });
  }, []);

  // Listen to OS appearance changes
  useEffect(() => {
    const subscription = Appearance.addChangeListener(({ colorScheme }) => {
      setDeviceScheme(colorScheme === 'light' ? 'light' : 'dark');
    });
    return () => subscription.remove();
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    SecureStore.setItemAsync(PREF_KEY, p).catch(() => {
      // Best-effort persistence; if it fails, the in-memory state still wins
    });
  }, []);

  const setDensity = useCallback((d: Density) => {
    setDensityState(d);
    SecureStore.setItemAsync(DENSITY_KEY, d).catch(() => {
      // Best-effort persistence; in-memory state still wins
    });
  }, []);

  // Resolve active mode: preference overrides system
  const mode: ThemeMode = preference === 'system' ? deviceScheme : preference;
  const tokens = mode === 'dark' ? DARK_TOKENS : LIGHT_TOKENS;

  const value = React.useMemo<ThemeContextValue>(
    () => ({ mode, preference, setPreference, density, setDensity, tokens }),
    [mode, preference, setPreference, density, setDensity, tokens],
  );

  return React.createElement(ThemeContext.Provider, { value }, children);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
