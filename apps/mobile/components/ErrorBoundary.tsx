/**
 * ErrorBoundary — class component that catches descendant render errors
 * and renders a themed fallback UI with a retry button.
 *
 * Wrap each route group's _layout in one so a single screen's crash
 * doesn't take down the whole app. For deeper isolation, wrap individual
 * heavy screens too (Map, Lightbox, Setlist composer).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { useTheme } from '../lib/theme';
import { RADII } from '../lib/theme-utils';

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Optional override fallback. Receives the error and a reset callback.
   * If omitted, a sensible default is rendered.
   */
  fallback?: (props: { error: Error; reset: () => void }) => React.ReactElement;
  /** Called once whenever an error is caught (for logging / telemetry). */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback({ error: this.state.error, reset: this.reset });
      }
      return <DefaultErrorFallback error={this.state.error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

/**
 * Default fallback. Themed via useTheme hook (allowed inside a function
 * component — class component delegates rendering to this).
 */
function DefaultErrorFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      <AlertTriangle size={32} color={colors.danger} />
      <Text
        style={{
          color: colors.ink,
          fontFamily: 'Geist Sans',
          fontSize: 17,
          fontWeight: '600',
          marginTop: 16,
          textAlign: 'center',
        }}
      >
        Something went wrong
      </Text>
      <Text
        style={{
          color: colors.muted,
          fontFamily: 'Geist Sans',
          fontSize: 13,
          marginTop: 8,
          maxWidth: 280,
          textAlign: 'center',
        }}
      >
        {error.message || 'The screen hit an unexpected error.'}
      </Text>
      <Pressable
        onPress={reset}
        style={[
          styles.button,
          { backgroundColor: colors.accent },
        ]}
      >
        <Text
          style={{
            color: colors.accentText,
            fontFamily: 'Geist Sans',
            fontSize: 14,
            fontWeight: '600',
          }}
        >
          Try again
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  button: {
    marginTop: 24,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: RADII.pill,
  },
});
