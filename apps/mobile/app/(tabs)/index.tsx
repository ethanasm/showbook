/**
 * Home tab — M1 placeholder.
 *
 * Real implementation (now-playing card, upcoming carousel, recent log)
 * lands in M2. For M1 this is just a centered EmptyState pointing at
 * the upcoming milestone.
 */

import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Music } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../lib/theme';

export default function HomeScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors.bg, paddingTop: insets.top }}>
      <TopBar title="Home" eyebrow="NOW PLAYING" large />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState
          icon={<Music size={40} color={tokens.colors.faint} strokeWidth={1.5} />}
          title="Home arrives in M2"
          subtitle="Upcoming shows, recent log, and now-playing card land in the next milestone."
        />
      </ScrollView>
    </View>
  );
}
