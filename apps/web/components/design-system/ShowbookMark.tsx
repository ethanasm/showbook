/**
 * ShowbookMark — the inline ticket brand mark for the web app.
 *
 * Renders the same silhouette as the mobile `BrandMark` and the master
 * 1024×1024 icon (apps/mobile/assets/icon.png) — a solid gold ticket
 * with side notches and a punched-out "S". The standalone SVG file at
 * `apps/web/public/showbook-mark.svg` mirrors this component; the inline
 * version is preferred in JSX because it inherits theme color tokens
 * through CSS variables and avoids the extra HTTP request.
 *
 * The S stays a fixed deep ink (`#0B0B0A`) in both light and dark
 * themes — using the variable `--bg` would make the cut-out invisible
 * on the light background.
 */

import type { CSSProperties } from "react";

export interface ShowbookMarkProps {
  size?: number;
  className?: string;
  /** Overrides the gold tone (defaults to `var(--accent)`). */
  tone?: string;
  style?: CSSProperties;
}

export function ShowbookMark({
  size = 28,
  className,
  tone,
  style,
}: ShowbookMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
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
          y="41.5"
          fontFamily="var(--font-geist-sans), -apple-system, BlinkMacSystemFont, 'Inter', 'Helvetica Neue', sans-serif"
          fontWeight={900}
          fontSize={26}
          fill="#0B0B0A"
          textAnchor="middle"
          letterSpacing="-1"
        >
          S
        </text>
      </g>
    </svg>
  );
}
