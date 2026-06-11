/**
 * Tab navigator for the authenticated app shell.
 *
 * Five tabs in the order Home · Shows · Add · Map · Discover. Discover
 * lives in the bottom bar (replacing the old Me tab) so the queue of
 * what's coming up is one tap away; Me/Settings has moved to a stack
 * route reachable via the user icon in the top-right of every main
 * screen (see `components/MeTopBarAction.tsx`). The center "Add" tab
 * is rendered as a raised FAB-style button (accent fill, marginTop:
 * -16) that lifts above the tab bar — this is the primary visual
 * affordance of the bottom nav.
 *
 * Tablet (≥900pt window width): the same five sections, but the bar
 * moves to a compact vertical icon rail on the left edge — the
 * signature iPad navigation pattern — via the navigator's
 * `tabBarPosition: 'left'` + `tabBarVariant: 'material'`. Routing,
 * deep links, and tab state are identical to phone; only the chrome
 * placement changes. The content area then belongs to the section:
 * Map gets the full remaining width, and the Shows tab composes a
 * two-pane list / detail split (`components/SplitViewLayout`) instead
 * of pushing show detail as a stack route. This replaced the earlier
 * three-pane shell that crammed Shows + detail + Map into one row and
 * dropped Home / Add / Discover on iPad entirely.
 *
 * The headerShown:false at the screenOptions level means each tab screen
 * owns its own TopBar; the tab bar itself is the only chrome rendered by
 * this layout. Tab bar colors, border, and label typography come from the
 * theme tokens so the bar tracks light/dark mode automatically.
 *
 * Bottom safe-area (phone): tabBarStyle.paddingBottom and the bar's
 * height are extended by `insets.bottom` so the home-indicator on
 * iPhones with no physical home button doesn't overlap the icons/labels.
 * Devices without a home indicator get a small floor (4pt) so labels
 * still breathe.
 *
 * FAB tap target (phone): the visible button is raised 16pt above the
 * tab cell with marginTop: -16, so the standard tab cell would not
 * register taps on the top half of the visible disc. We use
 * `tabBarButton` with a `Pressable` plus `hitSlop` so taps anywhere on
 * the visible FAB (and a small margin around it) trigger navigation to
 * the Add tab. On the rail the disc sits inline (no lift — there's no
 * bar edge to pop above).
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
import { Home, List, Plus, MapPin, Compass } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';
import { useBreakpoint } from '@/lib/responsive';
import { hapticSelection } from '@/lib/haptics';

const TAB_BAR_BASE_HEIGHT = 50;

export default function TabsLayout(): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const insets = useSafeAreaInsets();
  // Floor at 4pt so devices without a home indicator (older iPhones, most
  // Android phones) still leave a small breathing gap under the labels.
  const bottomPad = Math.max(insets.bottom, 4);
  // Tablet: vertical icon rail on the left edge instead of bottom tabs.
  const rail = useBreakpoint() === 'tablet';

  return (
    <Tabs
      screenListeners={{
        tabPress: () => {
          // Fire-and-forget; the haptic helper short-circuits on web
          // and swallows errors on native.
          void hapticSelection();
        },
      }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        // 'material' is the navigator's side-rail variant; it's only
        // valid with a left/right position, hence the paired switch.
        // Labels default to beside-icon on a side bar (a wide Mail-style
        // sidebar) — forcing below-icon collapses it to the compact
        // icon rail so the content area keeps the width.
        tabBarPosition: rail ? 'left' : 'bottom',
        tabBarVariant: rail ? 'material' : 'uikit',
        tabBarLabelPosition: rail ? 'below-icon' : undefined,
        tabBarStyle: rail
          ? {
              backgroundColor: colors.surface,
              borderRightColor: colors.rule,
              borderRightWidth: StyleSheet.hairlineWidth,
            }
          : {
              backgroundColor: colors.surface,
              borderTopColor: colors.rule,
              borderTopWidth: StyleSheet.hairlineWidth,
              paddingBottom: bottomPad,
              height: TAB_BAR_BASE_HEIGHT + bottomPad,
            },
        tabBarLabelStyle: {
          fontFamily: 'Geist Sans 500',
          // The rail has room for a legible label; the bottom bar keeps
          // the tight 10pt to fit five cells on small phones.
          fontSize: rail ? 12 : 10,
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
          // testID for Maestro flows — see apps/mobile/e2e/flows/. The
          // accessibilityLabel below is what voice-over reads; the
          // testID is what Maestro selectors match. React Navigation
          // bottom-tab passes this prop through to tabBarButton.
          tabBarButtonTestID: 'add-tab',
          // Custom button so the tappable region matches the visible FAB
          // (which extends 16pt above the tab cell). Without this the top
          // half of the disc is non-interactive — see header docblock.
          tabBarButton: (props) => (
            <AddTabButton
              {...props}
              vertical={rail}
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
        name="discover"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size }) => <Compass size={size} color={color} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
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
  /** True on the tablet rail — the disc sits inline in the column
   *  instead of lifting above the bottom bar. */
  vertical?: boolean;
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
  vertical = false,
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
      // Bottom bar: the visible disc lifts 16pt above the cell, so extend
      // the hit target up by 20pt to cover the whole disc plus a tap
      // margin. Rail: the disc is inline, a symmetric margin suffices.
      hitSlop={
        vertical
          ? { top: 8, bottom: 8, left: 8, right: 8 }
          : { top: 20, bottom: 8, left: 8, right: 8 }
      }
      style={[vertical ? styles.addCellVertical : styles.addCell, style]}
    >
      <View
        style={[
          styles.addFab,
          !vertical && styles.addFabLifted,
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
  addCellVertical: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  addFab: {
    width: 48,
    height: 48,
    borderRadius: RADII.pill,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.27,
    shadowRadius: 16,
    elevation: 6,
  },
  addFabLifted: {
    // Raise the FAB above the tab bar baseline so it visually pops out,
    // matching the design source (BottomNav, marginTop: -16). Hit-slop on
    // the parent Pressable makes the lifted region tappable too.
    marginTop: -16,
  },
});
