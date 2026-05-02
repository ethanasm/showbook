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
 * Bottom safe-area: tabBarStyle.paddingBottom and the bar's height are
 * extended by `insets.bottom` so the home-indicator on iPhones with no
 * physical home button doesn't overlap the icons/labels. Devices without
 * a home indicator get a small floor (4pt) so labels still breathe.
 *
 * FAB tap target: the visible button is raised 16pt above the tab cell
 * with marginTop: -16, so the standard tab cell would not register taps
 * on the top half of the visible disc. We use `tabBarButton` with a
 * `Pressable` plus `hitSlop` so taps anywhere on the visible FAB (and
 * a small margin around it) trigger navigation to the Add tab.
 */

import React from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  type AccessibilityRole,
  type GestureResponderEvent,
  type PressableAndroidRippleConfig,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, List, Plus, MapPin, User } from 'lucide-react-native';
import { useTheme } from '../../lib/theme';
import { useBreakpoint } from '../../lib/responsive';
import { ThreePaneLayout, useSelectedShow } from '../../components/ThreePaneLayout';
import { EmptyState } from '../../components/EmptyState';
import ShowsScreen from './shows';
import MapScreen from './map';
import ShowDetailScreen from '../show/[id]';

const TAB_BAR_BASE_HEIGHT = 50;

export default function TabsLayout(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  // Floor at 4pt so devices without a home indicator (older iPhones, most
  // Android phones) still leave a small breathing gap under the labels.
  const bottomPad = Math.max(insets.bottom, 4);
  const breakpoint = useBreakpoint();

  // iPad / large-screen shell: three-pane composition replaces the 5-tab
  // bottom nav. Selection plumbing lives in `useSelectedShow()` from the
  // ThreePaneLayout — the Shows pane writes a show id when the user
  // taps a row, the middle pane reads it as ShowDetail's `showIdProp`,
  // and a placeholder is rendered when nothing is selected yet.
  if (breakpoint === 'tablet') {
    return (
      <ThreePaneLayout
        left={<ShowsScreen />}
        middle={<IpadDetailPane />}
        right={<MapScreen />}
      />
    );
  }

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
          paddingBottom: bottomPad,
          height: TAB_BAR_BASE_HEIGHT + bottomPad,
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
          // Custom button so the tappable region matches the visible FAB
          // (which extends 16pt above the tab cell). Without this the top
          // half of the disc is non-interactive — see header docblock.
          tabBarButton: (props) => (
            <AddTabButton
              {...props}
              fabColor={colors.accent}
              iconColor={colors.accentText}
            />
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

function IpadDetailPane(): React.JSX.Element {
  const { showId } = useSelectedShow();
  const { tokens } = useTheme();
  if (!showId) {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.colors.bg }}>
        <EmptyState
          title="Select a show"
          subtitle="Tap a show on the left to see its details and map preview here."
        />
      </View>
    );
  }
  return <ShowDetailScreen showIdProp={showId} />;
}

// We avoid importing BottomTabBarButtonProps from @react-navigation/bottom-tabs
// because the package isn't a direct dep of @showbook/mobile (it ships as
// a transitive dep of expo-router and isn't exposed to TS resolution).
// Instead we define a minimal structural type covering the fields the
// navigator actually passes; extra props (children, href, etc.) are
// discarded which is fine for our render path.
interface AddTabButtonOwnProps {
  onPress?: ((e: GestureResponderEvent) => void) | null;
  onLongPress?: ((e: GestureResponderEvent) => void) | null;
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: { selected?: boolean };
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  android_ripple?: PressableAndroidRippleConfig | null;
}

interface AddTabButtonProps extends AddTabButtonOwnProps {
  fabColor: string;
  iconColor: string;
}

function AddTabButton({
  onPress,
  onLongPress,
  accessibilityState,
  accessibilityLabel,
  testID,
  style,
  android_ripple,
  fabColor,
  iconColor,
}: AddTabButtonProps): React.JSX.Element {
  return (
    <Pressable
      onPress={onPress ?? undefined}
      onLongPress={onLongPress ?? undefined}
      // Force button role even when the navigator passes a different
      // semantic role — this widget is unambiguously a button.
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel ?? 'Add'}
      testID={testID}
      android_ripple={android_ripple ?? undefined}
      // The visible disc lifts 16pt above the cell, so extend the hit
      // target up by 20pt to cover the whole disc plus a tap margin.
      hitSlop={{ top: 20, bottom: 8, left: 8, right: 8 }}
      style={[styles.addCell, style]}
    >
      <View
        style={[
          styles.addFab,
          { backgroundColor: fabColor, shadowColor: fabColor },
        ]}
      >
        <Plus size={28} color={iconColor} strokeWidth={2.5} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    // Raise the FAB above the tab bar baseline so it visually pops out,
    // matching the design source (BottomNav, marginTop: -16). Hit-slop on
    // the parent Pressable makes the lifted region tappable too.
    marginTop: -16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.27,
    shadowRadius: 16,
    elevation: 6,
  },
});
