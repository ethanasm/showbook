/**
 * ShowbookMark — the inline ticket brand mark for the web app.
 *
 * Renders the same gold-ticket silhouette as the mobile `BrandMark` and
 * the master 1024×1024 icon (apps/mobile/assets/icon.png): a solid gold
 * ticket with side notches and a punched-out "S".
 *
 * The `viewBox` is cropped tight to the −6° rotated artwork (plus ~1u of
 * breathing room), so `size` maps to the mark's true rendered height
 * instead of a half-empty square. The ticket is wider than it is tall,
 * so the SVG renders at that aspect (`width = size * ASPECT`).
 *
 * The standalone SVG at `apps/web/public/showbook-mark.svg` mirrors this
 * geometry; the inline version is preferred in JSX because it inherits
 * theme color tokens through CSS variables and avoids the extra request.
 *
 * The S stays a fixed deep ink (`#0B0B0A`) in both light and dark
 * themes — using the variable `--bg` would make the cut-out invisible
 * on the light background.
 */

import type { CSSProperties } from "react";

// Cropped to the −6°-rotated ticket bounding box. The ticket art is
// ~1.38:1, so the mark renders at that ratio rather than a padded square.
const VIEW_BOX = { x: 8.5, y: 15, w: 47, h: 34 } as const;
const ASPECT = VIEW_BOX.w / VIEW_BOX.h;

export interface ShowbookMarkProps {
  /** Rendered height in px. Width is derived from the mark's aspect ratio. */
  size?: number;
  className?: string;
  /** Overrides the gold tone (defaults to `var(--accent)`). */
  tone?: string;
  style?: CSSProperties;
}

export function ShowbookMark({
  size = 24,
  className,
  tone,
  style,
}: ShowbookMarkProps) {
  return (
    <svg
      width={size * ASPECT}
      height={size}
      viewBox={`${VIEW_BOX.x} ${VIEW_BOX.y} ${VIEW_BOX.w} ${VIEW_BOX.h}`}
      className={className}
      style={style}
      role="img"
      aria-label="Showbook"
    >
      <title>Showbook</title>
      <g transform="rotate(-6 32 32)">
        <path
          fill={tone ?? "var(--accent, #FFD166)"}
          fillRule="evenodd"
          d="M 14.5 18 H 49.5 A 3.5 3.5 0 0 1 53 21.5 V 30 A 3.75 3.75 0 0 0 49.25 33.75 A 3.75 3.75 0 0 0 53 37.5 V 42.5 A 3.5 3.5 0 0 1 49.5 46 H 14.5 A 3.5 3.5 0 0 1 11 42.5 V 37.5 A 3.75 3.75 0 0 0 14.75 33.75 A 3.75 3.75 0 0 0 11 30 V 21.5 A 3.5 3.5 0 0 1 14.5 18 Z"
        />
        <text
          x="32"
          y="40"
          fontFamily="var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif"
          fontWeight={900}
          fontSize={23}
          fill="#0B0B0A"
          textAnchor="middle"
        >
          S
        </text>
      </g>
    </svg>
  );
}
