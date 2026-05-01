/**
 * Sheet — declarative bottom sheet wrapper over @gorhom/bottom-sheet.
 *
 * DEPENDENCY NOTE: BottomSheetModalProvider must be an ancestor in the React
 * tree. This is added in Task 6's root layout (_layout.tsx). If Sheet is
 * rendered without a provider, @gorhom/bottom-sheet will throw a context error
 * at runtime.
 *
 * Implementation pattern: BottomSheetModal is imperative (uses a ref to
 * present/dismiss). This component wraps it declaratively via an open prop,
 * calling ref.current.present() / ref.current.dismiss() in a useEffect that
 * responds to prop changes.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import { useTheme } from '../lib/theme';

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
  const ref = useRef<BottomSheetModal>(null);
  const { tokens } = useTheme();
  const { colors } = tokens;

  // Sync declarative prop → imperative API
  useEffect(() => {
    if (open) {
      ref.current?.present();
    } else {
      ref.current?.dismiss();
    }
  }, [open]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.5}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleDismiss: BottomSheetModalProps['onDismiss'] = useCallback(() => {
    onClose();
  }, [onClose]);

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      backgroundStyle={{ backgroundColor: colors.surfaceRaised }}
      handleIndicatorStyle={{ backgroundColor: colors.ruleStrong }}
      enablePanDownToClose
    >
      {children}
    </BottomSheetModal>
  );
}
