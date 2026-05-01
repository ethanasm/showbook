/**
 * First-run step 2 of 4 — photo library permission.
 *
 * Triggers the OS prompt via expo-media-library on Continue. Skip advances
 * silently — the user can grant later via the Settings screen.
 */

import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import * as MediaLibrary from 'expo-media-library';
import { FirstRunStep, heroTitleStyle } from './_components';
import { useTheme } from '../../../lib/theme';

export default function FirstRunPhotos(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const advance = React.useCallback(() => {
    router.push('/(auth)/first-run/location');
  }, [router]);

  const onPrimary = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await MediaLibrary.requestPermissionsAsync(false);
    } catch {
      // ignore
    } finally {
      setPending(false);
      advance();
    }
  }, [advance, pending]);

  // Stylized stacked-photos illustration. Uses surfaceRaised across all
  // three cards so the illustration adapts to dark/light theme. Original
  // design used three distinct tones for visual flair; we trade that off
  // for theme correctness — the rotations alone read as a stack.
  const illustration = (
    <View style={styles.illustration}>
      {[
        { rotate: '-8deg', top: 10, left: 28 },
        { rotate: '6deg', top: 18, left: 70 },
        { rotate: '-3deg', top: 4, left: 110 },
      ].map((p, i) => (
        <View
          key={i}
          style={[
            styles.photo,
            {
              top: p.top,
              left: p.left,
              backgroundColor: colors.surfaceRaised,
              transform: [{ rotate: p.rotate }],
              borderColor: colors.bg,
            },
          ]}
        />
      ))}
    </View>
  );

  return (
    <FirstRunStep
      step={2}
      total={4}
      eyebrow="STEP 2 OF 4"
      title={
        <Text style={[heroTitleStyle, { color: colors.ink, textAlign: 'center' }]}>
          Save your <Text style={{ color: colors.accent }}>encore.</Text>
        </Text>
      }
      body="Attach photos and short clips to each show. Tag the band. Build a real archive — privately. Your library never leaves your account."
      illustration={illustration}
      primaryLabel="Allow photo access"
      onPrimary={onPrimary}
      secondaryLabel="Skip — I'll do this later"
      onSecondary={advance}
      pending={pending}
    />
  );
}

const styles = StyleSheet.create({
  illustration: {
    width: 200,
    height: 130,
    position: 'relative',
  },
  photo: {
    position: 'absolute',
    width: 76,
    height: 100,
    borderRadius: 6,
    borderWidth: 2,
  },
});
