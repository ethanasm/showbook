/**
 * GradientEmphasis — accent-coloured `<Text>` used as the emphasised tail
 * of editorial titles (Home / Discover / Shows / Show detail / Song / Artist /
 * Venue heros). Always renders a plain `<Text>` so it composes safely as an
 * inline child of a parent `<Text>` — the call sites consistently nest it
 * inside one (`<Text numberOfLines={2}>...{head}<GradientEmphasis>{tail}
 * </GradientEmphasis></Text>`) so that title metrics, truncation, and line
 * breaks work as one block.
 *
 * History (why this is no longer the masked-gradient version):
 *
 *   The first cut wrapped the children in `@react-native-masked-view/masked-view`
 *   + `expo-linear-gradient` to clip a 135deg accent→theatre gradient to the
 *   glyph shape — mirroring the web `.gradient-emphasis` rule
 *   (`background-clip: text`). On iOS that works in isolation, but **inside a
 *   parent `<Text>`** the MaskedView is a UIView that iOS's text layout can't
 *   compose inline, causing a native crash the moment the screen mounts. The
 *   probe in PR #256 dodged the bug only because the user's dev client at the
 *   time hadn't been rebuilt with `RNCMaskedView` linked, so the fallback path
 *   ran instead. Once the user installed a fresh native binary with MaskedView
 *   registered, the show-detail / song-detail / artist-detail / venue-detail /
 *   GetStartedHub heros all crashed on mount.
 *
 *   Web's `background-clip: text` is a paint-time effect on the existing text
 *   node — no nested view. RN has no equivalent that's safe under a parent
 *   `<Text>`. Restructuring every call site to host the MaskedView at the
 *   block level (and re-implementing manual head/tail layout, head-width
 *   measurement, line-break handling) is more risk than the visual flair is
 *   worth. Solid accent on the tail word is still visually distinct and
 *   matches what shipped on every binary up to the fresh rebuild — make it
 *   permanent.
 */

import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

interface GradientEmphasisProps {
  children: string;
  style?: StyleProp<TextStyle>;
}

export function GradientEmphasis({
  children,
  style,
}: GradientEmphasisProps): React.JSX.Element {
  const { tokens } = useTheme();
  const accent = tokens.colors.accent;
  return <Text style={[style, { color: accent }]}>{children}</Text>;
}
