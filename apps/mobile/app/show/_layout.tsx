/**
 * Stack layout for the /show/* group.
 *
 * The root layout uses <Slot/>, so this Stack is the only navigation
 * container above the detail screen. We hide the native header because
 * the screen renders its own TopBar (with a back leading slot) that
 * matches the design tokens; the platform header would be redundant
 * and use the wrong typography.
 */

import React from 'react';
import { Stack } from 'expo-router';

export default function ShowStackLayout(): React.JSX.Element {
  return <Stack screenOptions={{ headerShown: false }} />;
}
