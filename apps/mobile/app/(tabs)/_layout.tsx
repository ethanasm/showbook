/**
 * Tab navigator for the authenticated app shell.
 *
 * Five tabs in the order Home · Shows · Add · Map · Me, matching the design
 * source (showbook-tokens.jsx BottomNav). The center "Add" tab is rendered
 * as a raised FAB-style button (accent fill, marginTop: -16) that lifts above
 * the tab bar — this is the primary visual affordance of the bottom nav.
 *
 * The headerShown:false at the screenOptions level means each tab screen
 * owns its own TopBar; the tab bar itself is the only chrome rendered by
 * this layout. Tab bar colors, border, and label typography come from the
 * theme tokens so the bar tracks light/dark mode automatically.
 *
 * Note on the FAB tap target: marginTop: -16 raises the icon visually but
 * the underlying Tabs.Screen tap area is still the standard tab cell, so
 * the tappable region remains the full-width tab cell. The visible button
 * stays inside the tab cell vertically (48px button starting -16 above
 * the cell top still sits within the standard ~50pt tab bar height).
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Tabs } from 'expo-router';
import { Home, List, Plus, MapPin, User } from 'lucide-react-native';
import { useTheme } from '../../lib/theme';

export default function TabsLayout(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.rule,
          borderTopWidth: StyleSheet.hairlineWidth,
        },
        tabBarLabelStyle: {
          fontFamily: 'Geist Sans',
          fontSize: 10,
          fontWeight: '500',
          letterSpacing: 0.2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="shows"
        options={{
          title: 'Shows',
          tabBarIcon: ({ color, size }) => <List size={size} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          tabBarLabel: () => null,
          tabBarIcon: () => (
            <View
              style={[
                styles.addFab,
                {
                  backgroundColor: colors.accent,
                  shadowColor: colors.accent,
                },
              ]}
            >
              <Plus size={28} color={colors.accentText} strokeWidth={2.5} />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => <MapPin size={size} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{
          title: 'Me',
          tabBarIcon: ({ color, size }) => <User size={size} color={color} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    // Raise the FAB above the tab bar baseline so it visually pops out,
    // matching the design source (BottomNav, marginTop: -16).
    marginTop: -16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.27,
    shadowRadius: 16,
    elevation: 6,
  },
});
