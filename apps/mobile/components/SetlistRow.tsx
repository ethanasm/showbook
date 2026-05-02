/**
 * SetlistRow — single track row inside the setlist composer.
 *
 * The drag handle on the right is rendered visually here; the parent
 * `DraggableFlatList` wires the actual long-press → drag gesture.
 * The row exposes `onLongPress` so the composer can start a drag (or
 * surface an action sheet) without the row needing to know about
 * `react-native-draggable-flatlist`.
 *
 * Encore tracks get a subtle accent on the track number — the encore
 * divider itself is rendered by the composer, not the row.
 */

import React from 'react';
import { View, Text, Pressable, TextInput, StyleSheet } from 'react-native';
import { GripVertical, X } from 'lucide-react-native';
import { useTheme } from '../lib/theme';

export interface SetlistRowProps {
  trackNumber: number;
  title: string;
  isEncore?: boolean;
  editable?: boolean;
  onChangeTitle?: (next: string) => void;
  onLongPress?: () => void;
  onRemove?: () => void;
  testID?: string;
}

export function SetlistRow({
  trackNumber,
  title,
  isEncore = false,
  editable = false,
  onChangeTitle,
  onLongPress,
  onRemove,
  testID,
}: SetlistRowProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={250}
      accessibilityRole="button"
      accessibilityLabel={`Track ${trackNumber}: ${title}${isEncore ? ' (encore)' : ''}`}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: colors.surface, borderBottomColor: colors.rule },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          styles.trackNumber,
          { color: isEncore ? colors.accent : colors.faint },
          isEncore && styles.trackNumberEncore,
        ]}
      >
        {trackNumber}
      </Text>

      {editable ? (
        <TextInput
          value={title}
          onChangeText={onChangeTitle}
          placeholder="Song title"
          placeholderTextColor={colors.faint}
          style={[styles.title, { color: colors.ink }]}
          testID={testID ? `${testID}-input` : undefined}
        />
      ) : (
        <Text
          style={[styles.title, { color: colors.ink }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {title || 'Untitled'}
        </Text>
      )}

      {onRemove ? (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Remove track"
          testID={testID ? `${testID}-remove` : undefined}
        >
          <X size={16} color={colors.muted} strokeWidth={2} />
        </Pressable>
      ) : null}

      <View
        style={styles.handle}
        testID={testID ? `${testID}-handle` : 'setlist-row-handle'}
        accessibilityLabel="Drag handle"
      >
        <GripVertical size={16} color={colors.faint} strokeWidth={1.8} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  trackNumber: {
    fontFamily: 'Geist Sans',
    fontSize: 12,
    fontWeight: '500',
    width: 22,
    textAlign: 'right',
    letterSpacing: 0.4,
  },
  trackNumberEncore: {
    fontWeight: '700',
  },
  title: {
    flex: 1,
    fontFamily: 'Geist Sans',
    fontSize: 15,
    fontWeight: '500',
    padding: 0,
  },
  handle: {
    paddingHorizontal: 4,
  },
});
