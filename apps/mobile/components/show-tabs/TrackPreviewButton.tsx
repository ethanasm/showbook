/**
 * TrackPreviewButton (mobile) — 24pt ▶ button that lives in the third
 * column of every setlist row. Phase 10 Part B3 ports the web
 * `TrackPreview` component to React Native using the abstracted
 * `PreviewPlayerController`.
 *
 * Audio playback driver: this component owns a single `PreviewPlayer`
 * provider per show-detail screen. The driver is loaded lazily so a
 * missing native audio module (sandbox / Playwright web bundle) falls
 * back to the no-op driver and the button degrades to "unavailable"
 * after the first failed play, but the contract still works (toggle,
 * stop-previous, etc.).
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../../lib/theme';
import {
  PreviewPlayerController,
  NoopPlaybackDriver,
  type PlaybackDriver,
  type PreviewHandle,
  type PreviewPlayerState,
} from '../../lib/setlist-intel';

// ----------------------------------------------------------------------
// Provider + hook
// ----------------------------------------------------------------------

interface PreviewPlayerContextValue {
  controller: PreviewPlayerController;
  state: PreviewPlayerState;
}

const PreviewPlayerContext = React.createContext<PreviewPlayerContextValue | null>(
  null,
);

export interface PreviewPlayerProviderProps {
  /**
   * Inject a real audio driver. When omitted, the no-op driver is used
   * — useful for the headless web Playwright loop and for unit tests.
   * The native call site supplies an `expo-av`-backed driver once
   * available; for now we degrade gracefully.
   */
  driver?: PlaybackDriver;
  children: React.ReactNode;
}

export function PreviewPlayerProvider({
  driver,
  children,
}: PreviewPlayerProviderProps): React.JSX.Element {
  const [state, setState] = React.useState<PreviewPlayerState>({
    currentTrackKey: null,
    isPlaying: false,
  });

  // Build the controller once per provider; preserve identity across
  // re-renders so the underlying driver isn't torn down on every paint.
  const controllerRef = React.useRef<PreviewPlayerController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new PreviewPlayerController({
      driver: driver ?? new NoopPlaybackDriver(),
      onStateChange: (s) => setState(s),
    });
  }

  React.useEffect(() => {
    const controller = controllerRef.current;
    return () => {
      if (controller) {
        void controller.dispose();
      }
    };
  }, []);

  const value = React.useMemo<PreviewPlayerContextValue>(
    () => ({ controller: controllerRef.current as PreviewPlayerController, state }),
    [state],
  );

  return (
    <PreviewPlayerContext.Provider value={value}>
      {children}
    </PreviewPlayerContext.Provider>
  );
}

function usePreviewPlayer(): PreviewPlayerContextValue | null {
  return React.useContext(PreviewPlayerContext);
}

// ----------------------------------------------------------------------
// Button
// ----------------------------------------------------------------------

export interface TrackPreviewButtonProps {
  showId: string;
  title: string;
  previewUrl: string | null;
  spotifyTrackId: string | null;
}

export function TrackPreviewButton({
  showId,
  title,
  previewUrl,
  spotifyTrackId,
}: TrackPreviewButtonProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const ctx = usePreviewPlayer();
  const [unavailable, setUnavailable] = React.useState(false);
  const key = `${showId}:${title.toLowerCase()}`;
  const isActive = ctx?.state.currentTrackKey === key;
  const hasAnySource = Boolean(previewUrl ?? spotifyTrackId);

  // When mounted outside a provider (defensive), render a static slot
  // so the row's grid stays aligned.
  if (!ctx) {
    return (
      <View
        testID="track-preview-slot"
        style={[styles.button, { borderColor: colors.rule, opacity: 0.4 }]}
        accessibilityElementsHidden
      />
    );
  }

  const disabled = unavailable || !hasAnySource;

  const handle: PreviewHandle = {
    key,
    previewUrl,
    spotifyTrackId,
    label: title,
  };

  const onPress = async () => {
    if (disabled && !isActive) return;
    if (isActive) {
      await ctx.controller.stop();
      return;
    }
    await ctx.controller.play(handle, () => setUnavailable(true));
  };

  return (
    <Pressable
      onPress={() => {
        void onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        isActive ? 'Stop preview' : unavailable ? 'Preview unavailable' : 'Play 30-second preview'
      }
      testID={`track-preview-button-${title.toLowerCase().replace(/\s+/g, '-')}`}
      disabled={disabled && !isActive}
      style={[
        styles.button,
        {
          borderColor: colors.ruleStrong,
          backgroundColor: isActive ? colors.accent : 'transparent',
          opacity: disabled && !isActive ? 0.35 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.glyph,
          {
            borderLeftColor: isActive ? colors.accentText : colors.ink,
          },
        ]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: {
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    marginLeft: 2,
  },
});
