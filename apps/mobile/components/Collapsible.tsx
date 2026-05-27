/**
 * Minimal expand/collapse section used for the "More details"
 * slot on the add/edit show form. Animates open via LayoutAnimation
 * on iOS/Android — on web it's a static measure swap, which the
 * react-native-web shim handles fine.
 */

import React from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/lib/theme';

// Android requires opting-in to LayoutAnimation at process start.
if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface CollapsibleProps {
  label: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
  testID?: string;
}

export function Collapsible({
  label,
  defaultExpanded = false,
  children,
  testID,
}: CollapsibleProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const [expanded, setExpanded] = React.useState(defaultExpanded);

  const toggle = React.useCallback(() => {
    if (Platform.OS !== 'web') {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    }
    setExpanded((v) => !v);
  }, []);

  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <View style={styles.wrap} testID={testID}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
        style={({ pressed }) => [styles.header, pressed && { opacity: 0.7 }]}
      >
        <Chevron size={14} color={colors.muted} strokeWidth={2} />
        <Text style={[styles.label, { color: colors.muted }]}>
          {label.toUpperCase()}
        </Text>
      </Pressable>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
  },
  body: {
    gap: 16,
  },
});
