/**
 * First-run step 2 — coarse foreground location.
 *
 * We only ever ask for foreground permission — Showbook doesn't need
 * background tracking. On grant we read the device location once
 * (low accuracy is enough — we just need a city) and hand the coords
 * to the region step so the user can confirm or override.
 *
 * When the region step has been dropped from the flow (the user already
 * has a region), the captured coords have nowhere to go, so we fall
 * through to the flow's next screen (gmail) or finish onboarding.
 */

import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { FirstRunStep, heroTitleStyle } from './_components';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useFirstRunFlow } from '@/lib/useFirstRunFlow';
import { FIRST_RUN_ROUTES } from '@/lib/first-run-flow';

export default function FirstRunLocation(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const router = useRouter();
  const { position, goNext } = useFirstRunFlow();
  const pos = position('location');
  const [pending, setPending] = React.useState(false);

  const advance = React.useCallback(
    (params?: { lat: string; lng: string }) => {
      // Only the region step consumes the device coords. If it's still in
      // the flow, push it directly with the coords; otherwise hand off to
      // the flow's next screen (or finish).
      if (params && pos.nextRoute === FIRST_RUN_ROUTES.region) {
        router.push({ pathname: '/(auth)/first-run/region', params });
      } else {
        goNext('location');
      }
    },
    [goNext, pos.nextRoute, router],
  );

  const onPrimary = React.useCallback(async () => {
    if (pending) return;
    setPending(true);
    let lat: string | undefined;
    let lng: string | undefined;
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.granted) {
        try {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          });
          lat = String(pos.coords.latitude);
          lng = String(pos.coords.longitude);
        } catch {
          // getCurrentPositionAsync can time out on a cold GPS — the region
          // screen handles "no coords" by going straight into the city
          // picker.
        }
      }
    } catch {
      // permission API can throw on some sims — fall through to region step
    } finally {
      setPending(false);
      advance(lat && lng ? { lat, lng } : undefined);
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
          { top: '34%', left: '46%', width: 64, height: 64, borderRadius: RADII.pill, backgroundColor: colors.accent, opacity: 0.12 },
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
      step={pos.step}
      total={pos.total}
      eyebrow={`STEP ${pos.step} OF ${pos.total}`}
      title={
        <Text style={[heroTitleStyle, { color: colors.ink, textAlign: 'center' }]}>
          Shows <Text style={{ color: colors.accent }}>near you.</Text>
        </Text>
      }
      body="We use your location only to surface venues nearby, focus your daily email on shows around you, and prioritize on-sales in your region. Coarse location is enough — no background tracking."
      illustration={illustration}
      primaryLabel="Share my region"
      onPrimary={onPrimary}
      secondaryLabel="Use city instead"
      onSecondary={() => advance()}
      pending={pending}
    />
  );
}

const styles = StyleSheet.create({
  map: {
    width: 180,
    height: 130,
    borderRadius: RADII.lg,
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
    borderRadius: RADII.xs,
  },
  ring: {
    position: 'absolute',
  },
  pin: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: RADII.pill,
    borderWidth: 3,
  },
});
