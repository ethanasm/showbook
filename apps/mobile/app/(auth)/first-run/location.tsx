/**
 * First-run step 3 of 4 — coarse foreground location.
 *
 * We only ever ask for foreground permission — Showbook doesn't need
 * background tracking. The illustration is a simplified stylized map.
 */

import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { FirstRunStep, heroTitleStyle } from './_components';
import { useTheme } from '../../../lib/theme';

export default function FirstRunLocation(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const advance = React.useCallback(() => {
    router.push('/(auth)/first-run/gmail');
  }, [router]);

  const onPrimary = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    try {
      await Location.requestForegroundPermissionsAsync();
    } catch {
      // ignore — advance regardless
    } finally {
      setPending(false);
      advance();
    }
  }, [advance, pending]);

  // Stylized map illustration matching the design source
  const illustration = (
    <View style={[styles.map, { backgroundColor: colors.surface, borderColor: colors.rule }]}>
      {/* Faux roads */}
      <View style={[styles.roadH, { top: '40%', backgroundColor: colors.ruleStrong, opacity: 0.6 }]} />
      <View style={[styles.roadV, { left: '55%', backgroundColor: colors.ruleStrong, opacity: 0.6 }]} />
      <View style={[styles.roadH, { top: '70%', backgroundColor: colors.ruleStrong, opacity: 0.4 }]} />
      <View style={[styles.block, { top: '15%', left: '20%', width: 30, height: 16, backgroundColor: colors.rule, opacity: 0.6 }]} />
      <View style={[styles.block, { top: '52%', left: '60%', width: 22, height: 22, backgroundColor: colors.rule, opacity: 0.6 }]} />
      {/* Accuracy ring */}
      <View
        style={[
          styles.ring,
          { top: '34%', left: '46%', width: 64, height: 64, borderRadius: 32, backgroundColor: colors.accent, opacity: 0.12 },
        ]}
      />
      {/* Pin */}
      <View
        style={[
          styles.pin,
          {
            top: '46%',
            left: '52%',
            backgroundColor: colors.accent,
            borderColor: colors.bg,
          },
        ]}
      />
    </View>
  );

  return (
    <FirstRunStep
      step={3}
      total={4}
      eyebrow="STEP 3 OF 4"
      title={
        <Text style={[heroTitleStyle, { color: colors.ink, textAlign: 'center' }]}>
          Shows <Text style={{ color: colors.accent }}>near you.</Text>
        </Text>
      }
      body="We use your location only to surface venues nearby and prioritize the on-sales in your region. Coarse location is enough — no background tracking."
      illustration={illustration}
      primaryLabel="Share my region"
      onPrimary={onPrimary}
      secondaryLabel="Use city instead"
      onSecondary={advance}
      pending={pending}
    />
  );
}

const styles = StyleSheet.create({
  map: {
    width: 180,
    height: 130,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  roadH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
  },
  roadV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
  block: {
    position: 'absolute',
    borderRadius: 2,
  },
  ring: {
    position: 'absolute',
  },
  pin: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
  },
});
