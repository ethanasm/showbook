/**
 * Root-level `PreviewPlayerProvider` — owns one `PreviewPlayerController`
 * for the whole app session so playback survives navigation between
 * the show-detail, song, artist, etc. screens. The floating
 * `PreviewMiniPlayer` reads from the same context so the user can stop
 * the clip from anywhere.
 *
 * Lives in `lib/` (not `components/show-tabs/`) because both the show-
 * detail `TrackPreviewButton` and the global mini-player share it, and
 * `app/_layout.tsx` mounts it above the route stack.
 */

import React from 'react';

import {
  PreviewPlayerController,
  type PlaybackDriver,
  type PreviewPlayerState,
} from './setlist-intel';
import { ExpoAudioDriver } from './setlist-intel/expo-audio-driver';

interface PreviewPlayerContextValue {
  controller: PreviewPlayerController;
  state: PreviewPlayerState;
}

const PreviewPlayerContext = React.createContext<PreviewPlayerContextValue | null>(
  null,
);

export interface PreviewPlayerProviderProps {
  /**
   * Inject a custom playback driver — primarily for tests that want to
   * assert against `NoopPlaybackDriver` without dragging the
   * `expo-audio` native module into the unit-test loader. When omitted
   * the provider builds an `ExpoAudioDriver` so iOS / Android / web
   * bundles all get real audio playback.
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
    loadingKey: null,
    isPlaying: false,
    currentLabel: null,
  });

  // Build the controller once per provider; preserve identity across
  // re-renders so the underlying driver isn't torn down on every paint.
  const controllerRef = React.useRef<PreviewPlayerController | null>(null);
  if (controllerRef.current === null) {
    const resolved =
      driver ??
      new ExpoAudioDriver({
        onEnded: () => controllerRef.current?.handleEnded(),
      });
    controllerRef.current = new PreviewPlayerController({
      driver: resolved,
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

export function usePreviewPlayer(): PreviewPlayerContextValue | null {
  return React.useContext(PreviewPlayerContext);
}
