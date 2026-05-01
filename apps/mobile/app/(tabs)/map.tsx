/**
 * Map tab — M1 placeholder.
 *
 * Clustered pins and the venue sheet arrive in M2/M5.
 */

import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MapPin } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../lib/theme';

export default function MapScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors.bg, paddingTop: insets.top }}>
      <TopBar title="Map" eyebrow="VENUES · NEARBY" large />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState
          icon={<MapPin size={40} color={tokens.colors.faint} strokeWidth={1.5} />}
          title="Map"
          subtitle="Clustered pins and venue sheet arrive in M2/M5."
        />
      </ScrollView>
    </View>
  );
}
