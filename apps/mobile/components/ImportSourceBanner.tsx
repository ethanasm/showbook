/**
 * ImportSourceBanner — accent-tinted card pinned above the Add Show
 * form's fields when the form was pre-filled from an external source.
 *
 * Today the only variant is `'wallet'` (Apple Wallet share-sheet
 * import). Adding new sources is a switch on `variant` plus a copy
 * entry. Lives outside ShowFormFields so it never appears on Edit.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ticket } from 'lucide-react-native';

import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export type ImportSourceVariant = 'wallet';

const COPY: Record<ImportSourceVariant, { title: string; body: string; testID: string }> = {
  wallet: {
    title: 'Imported from Apple Wallet',
    body: "Review the details below and tap ✓ to add this show to your library.",
    testID: 'import-source-banner-wallet',
  },
};

export interface ImportSourceBannerProps {
  variant: ImportSourceVariant;
}

export function ImportSourceBanner({
  variant,
}: ImportSourceBannerProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const copy = COPY[variant];
  return (
    <View
      testID={copy.testID}
      style={[
        styles.frame,
        {
          backgroundColor: colors.accentFaded,
          borderColor: colors.accent,
        },
      ]}
    >
      <View style={styles.icon}>
        <Ticket size={18} color={colors.accent} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.ink }]}>{copy.title}</Text>
        <Text style={[styles.body, { color: colors.muted }]}>{copy.body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADII.lg,
    alignItems: 'flex-start',
  },
  icon: {
    paddingTop: 2,
  },
  title: {
    fontFamily: 'Geist Sans 500',
    fontSize: 13.5,
  },
  body: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    marginTop: 2,
    lineHeight: 16,
  },
});
