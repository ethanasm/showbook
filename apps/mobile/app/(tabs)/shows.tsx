/**
 * Shows tab — M1 placeholder.
 *
 * Real implementation (timeline, month view, stats) lands in M2.
 */

import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { List } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../lib/theme';

export default function ShowsScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors.bg, paddingTop: insets.top }}>
      <TopBar title="Shows" eyebrow="ALL · TIMELINE" large />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState
          icon={<List size={40} color={tokens.colors.faint} strokeWidth={1.5} />}
          title="Shows arrives in M2"
          subtitle="Timeline, month view, and stats arrive in M2."
        />
      </ScrollView>
    </View>
  );
}
