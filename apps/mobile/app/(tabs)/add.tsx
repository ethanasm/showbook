/**
 * Add tab — M1 placeholder.
 *
 * Chat-first add flow + form fallback land in M3. The bottom nav surfaces
 * Add as a raised FAB; tapping it routes here for M1 so users see the
 * "coming soon" copy rather than a blank screen.
 */

import React from 'react';
import { View, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MessageSquare } from 'lucide-react-native';
import { TopBar } from '../../components/TopBar';
import { EmptyState } from '../../components/EmptyState';
import { useTheme } from '../../lib/theme';

export default function AddScreen(): React.JSX.Element {
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: tokens.colors.bg, paddingTop: insets.top }}>
      <TopBar title="Add" eyebrow="LOG · IMPORT · WATCH" large />
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <EmptyState
          icon={<MessageSquare size={40} color={tokens.colors.faint} strokeWidth={1.5} />}
          title="Add a show"
          subtitle="Chat-first add and form fallback arrive in M3."
        />
      </ScrollView>
    </View>
  );
}
