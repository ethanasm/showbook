/**
 * KindFilterControl — the header filter affordance shared by the Discover,
 * Home, Shows, and Map tabs. Renders the `Filter` icon button (sized to sit
 * in a `TopBar` / `HomeHeader` right-action slot) and owns the open state of
 * the anchored `KindFilterMenu` it toggles.
 *
 * The active filter is lifted to the host screen (it drives that screen's
 * list/section/marker filtering), so this component is controlled: it takes
 * `value` + `onChange` and keeps only the menu's open/closed state locally.
 *
 * The icon fills with the accent colour while a specific kind is selected so
 * an active filter is obvious from the header without opening the menu.
 */

import React from 'react';
import { Pressable } from 'react-native';
import { Filter } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';
import { KindFilterMenu, type KindFilterValue } from './KindFilterMenu';

interface KindFilterControlProps {
  value: KindFilterValue;
  onChange: (value: KindFilterValue) => void;
  /** Namespaces the button / menu testIDs per host screen. */
  testIDPrefix?: string;
  /** Forwarded to the menu's vertical anchor (HomeHeader is shorter). */
  topOffset?: number;
}

export function KindFilterControl({
  value,
  onChange,
  testIDPrefix = 'discover',
  topOffset,
}: KindFilterControlProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [open, setOpen] = React.useState(false);
  const active = value !== 'all';

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Filter by kind"
        accessibilityState={{ expanded: open }}
        testID={`${testIDPrefix}-filter-button`}
      >
        <Filter
          size={20}
          color={active ? colors.accent : colors.ink}
          strokeWidth={2}
          fill={active ? colors.accent : 'transparent'}
        />
      </Pressable>
      <KindFilterMenu
        open={open}
        value={value}
        onSelect={onChange}
        onClose={() => setOpen(false)}
        testIDPrefix={testIDPrefix}
        topOffset={topOffset}
      />
    </>
  );
}
