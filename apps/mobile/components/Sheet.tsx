import React from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  snapPoints?: (string | number)[];
  children: React.ReactNode;
}

export function Sheet({
  open,
  onClose,
  snapPoints = ['50%'],
  children,
}: SheetProps): React.JSX.Element {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { height } = useWindowDimensions();
  const sheetHeight = resolveSnapPoint(snapPoints[0] ?? '50%', height);

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close sheet"
          onPress={onClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor: colors.surfaceRaised,
            },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.ruleStrong }]} />
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function resolveSnapPoint(snapPoint: string | number, screenHeight: number): number {
  if (typeof snapPoint === 'number') return Math.min(snapPoint, screenHeight);

  const percentMatch = snapPoint.match(/^(\d+(?:\.\d+)?)%$/);
  if (percentMatch) {
    const percent = Number(percentMatch[1]);
    if (Number.isFinite(percent)) {
      return Math.round(screenHeight * (percent / 100));
    }
  }

  return Math.round(screenHeight * 0.5);
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    width: '100%',
    borderTopLeftRadius: RADII.xl,
    borderTopRightRadius: RADII.xl,
    paddingTop: 10,
    paddingBottom: 18,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: RADII.pill,
    marginBottom: 8,
  },
});
