/**
 * FormField — uppercase faint label + themed TextInput in a single
 * leaf component. Replaces the per-screen `Field` + `Input` helpers
 * that the add/form and show/[id]/edit screens were both defining
 * with identical typography + border treatment.
 *
 * The `children` slot keeps the door open for screens that need a
 * custom control under the label (date picker, segmented control,
 * venue typeahead) — pass `children` instead of `value` /
 * `onChangeText` and the underlying TextInput is skipped.
 */

import React from 'react';
import { View, Text, TextInput, StyleSheet, type TextInputProps } from 'react-native';
import { useTheme } from '../lib/theme';

export interface FormFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  error?: string;
  /** Override the wrapper width — used by Row layouts. */
  flex?: number;
  /**
   * Optional control slot. When provided the embedded TextInput is
   * skipped — the label still renders, and the caller's node fills
   * the input area. `value` / `onChangeText` and other TextInputProps
   * are ignored in that mode.
   */
  children?: React.ReactNode;
}

export function FormField({
  label,
  error,
  flex,
  children,
  multiline,
  ...inputProps
}: FormFieldProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  return (
    <View style={[styles.field, flex !== undefined && { flex }]}>
      <Text style={[styles.label, { color: colors.faint }]}>
        {label.toUpperCase()}
      </Text>
      {children ?? (
        <TextInput
          {...inputProps}
          multiline={multiline}
          placeholderTextColor={colors.faint}
          style={[
            styles.input,
            {
              color: colors.ink,
              borderColor: error ? colors.danger : colors.rule,
              backgroundColor: colors.surface,
            },
            multiline && styles.multiline,
          ]}
        />
      )}
      {error && (
        <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>
      )}
    </View>
  );
}

export function FormRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  field: {
    gap: 6,
  },
  label: {
    fontFamily: 'Geist Sans',
    fontSize: 10.5,
    fontWeight: '600',
    letterSpacing: 1.05,
  },
  input: {
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '400',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  multiline: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  error: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '400',
  },
  row: {
    flexDirection: 'row',
    gap: 12,
  },
});
