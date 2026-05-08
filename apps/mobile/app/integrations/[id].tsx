/**
 * Integration manage stub — pushed from the Me tab integration rows.
 *
 * Connecting Gmail, Ticketmaster, or Google Places end-to-end on mobile is
 * a follow-up tracked in `showbook-specs/planned-improvements.md`. For now
 * this screen renders an EmptyState so the row tap has somewhere to go.
 */

import React from 'react';
import { View, Pressable, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft, Plug } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../lib/theme';

const TITLES: Record<string, string> = {
  gmail: 'Gmail',
  ticketmaster: 'Ticketmaster',
  'google-places': 'Google Places',
  spotify: 'Spotify',
};

export default function IntegrationStub(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const title = (id && TITLES[id]) ?? 'Integration';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <TopBar
        title={title}
        eyebrow="MANAGE INTEGRATION"
        leading={
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={styles.back}
          >
            <ChevronLeft size={22} color={colors.ink} />
            <Text style={[styles.backLabel, { color: colors.muted }]}>Back</Text>
          </Pressable>
        }
      />
      <EmptyState
        icon={<Plug size={40} color={colors.muted} />}
        title="Not yet on mobile"
        subtitle={`Connecting ${title} from mobile isn't wired up yet — for now, manage this integration from the web app.`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  backLabel: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '500',
  },
});
