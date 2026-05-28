import React from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '@/lib/theme';
import { RADII } from '@/lib/theme-utils';

const OPEN_DURATION_MS = 320;
const CLOSE_DURATION_MS = 240;
const OPEN_EASING = Easing.out(Easing.cubic);
const CLOSE_EASING = Easing.in(Easing.cubic);
// When the keyboard is up the sheet shrinks to fit the visible area
// above it. Leave this much breathing room at the top of the screen
// so the sheet doesn't slam into the status bar / notch.
const KEYBOARD_TOP_MARGIN = 56;
// Floor on the keyboard-shrunk height so a tiny landscape keyboard
// can't collapse the sheet to a sliver.
const MIN_SHEET_HEIGHT = 240;

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
}: SheetProps): React.JSX.Element | null {
  const { tokens } = useTheme();
  const { colors } = tokens;
  const { height } = useWindowDimensions();

  // Track the on-screen keyboard so we can shrink the sheet to fit the
  // visible area above it. Without this, a tall sheet (e.g. the
  // Discover add-typeahead at 72%) plus iOS's KAV `padding` behavior
  // pushes the top of the sheet — header + input — above the status
  // bar, so the user can't see what they're typing into.
  const [keyboardHeight, setKeyboardHeight] = React.useState(0);
  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const snapHeight = resolveSnapPoint(snapPoints[0] ?? '50%', height);
  const sheetHeight =
    keyboardHeight > 0
      ? Math.max(
          MIN_SHEET_HEIGHT,
          Math.min(snapHeight, height - keyboardHeight - KEYBOARD_TOP_MARGIN),
        )
      : snapHeight;

  const [mounted, setMounted] = React.useState(open);
  const progress = useSharedValue(open ? 1 : 0);

  React.useEffect(() => {
    if (open) {
      setMounted(true);
      progress.value = withTiming(1, {
        duration: OPEN_DURATION_MS,
        easing: OPEN_EASING,
      });
    } else {
      progress.value = withTiming(
        0,
        { duration: CLOSE_DURATION_MS, easing: CLOSE_EASING },
        (finished) => {
          if (finished) runOnJS(setMounted)(false);
        },
      );
    }
  }, [open, progress]);

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
  }));

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * sheetHeight }],
  }));

  if (!mounted) return null;

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close sheet"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              height: sheetHeight,
              backgroundColor: colors.surfaceRaised,
            },
            sheetStyle,
          ]}
        >
          <View style={[styles.handle, { backgroundColor: colors.ruleStrong }]} />
          {children}
        </Animated.View>
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
