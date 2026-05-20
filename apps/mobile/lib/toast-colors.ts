/**
 * Shared color resolver for the floating Toast and the persistent
 * Banner. Centralized so the contrast story is defined once.
 *
 * Why centralize: both surfaces previously used a 13%-alpha tint of
 * `colors.danger` for the error background, painted the same red on
 * the foreground text, and ended up barely distinguishable from the
 * page underneath. The screen the user is reading bled through, the
 * red-on-red error message was hard to read, and the toast didn't
 * feel like a floating UI layer at all. The fix lives here so both
 * hosts pick up the same solid backgrounds + contrasting text.
 *
 * Variants:
 *   - error:   solid danger background, white foreground
 *   - success: solid accent background, accent-on-accent foreground
 *   - info:    surfaceRaised + ink (subtle but solid)
 *
 * The returned `border` matches the background so a 1px border
 * doesn't double up the visual weight; callers that want a contrast
 * border (e.g. the Banner separator) can override.
 */

export type FeedbackVariant = 'info' | 'success' | 'error';

export interface FeedbackVariantColors {
  background: string;
  text: string;
  border: string;
}

export interface FeedbackVariantInputColors {
  surface: string;
  surfaceRaised: string;
  ink: string;
  accent: string;
  accentText: string;
  danger: string;
  ruleStrong: string;
}

export function feedbackVariantColors(
  kind: FeedbackVariant,
  colors: FeedbackVariantInputColors,
): FeedbackVariantColors {
  switch (kind) {
    case 'error':
      return {
        background: colors.danger,
        // Hard-coded white instead of a theme color: every theme's
        // `ink` is dark, and we want max-contrast on the red surface
        // regardless of light/dark mode.
        text: '#FFFFFF',
        border: colors.danger,
      };
    case 'success':
      return {
        background: colors.accent,
        text: colors.accentText,
        border: colors.accent,
      };
    default:
      return {
        background: colors.surfaceRaised,
        text: colors.ink,
        border: colors.ruleStrong,
      };
  }
}
