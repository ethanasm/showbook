"use client";

import { useEffect, useState, type ReactNode } from "react";

interface ShowDetailRightRailProps {
  /** Pre-show vs post-show — drives the slot manifest. */
  isPast: boolean;
  /**
   * Atom-bearing children. Pass `null` for slots the calling phase
   * doesn't yet fill. Empty result hides the rail entirely.
   */
  slots: {
    vibeRadar?: ReactNode;
    energyArc?: ReactNode;
    hypePlaylistCard?: ReactNode;
    fanLoyaltyRing?: ReactNode;
  };
}

/**
 * Right-rail shell. Phase 1 (this PR) ships an empty container with
 * slot logic so Phases 3/7/8 can drop atoms in without re-plumbing
 * the layout. Pre-show shows VibeRadar (predicted) + HypePlaylistCard;
 * post-show shows VibeRadar (actual) + EnergyArc + FanLoyaltyRing.
 *
 * Hidden below 1200px (the breakpoint from `components.jsx`); the
 * matching atoms render inline inside the tabs instead.
 *
 * Hidden entirely when every slot resolves to a falsy value — until
 * Phase 3/7/8 land their content the rail is invisible.
 */
export function ShowDetailRightRail({
  isPast,
  slots,
}: ShowDetailRightRailProps) {
  const manifest = isPast
    ? [slots.vibeRadar, slots.energyArc, slots.fanLoyaltyRing]
    : [slots.vibeRadar, slots.hypePlaylistCard];
  const populated = manifest.filter(Boolean);

  const [wideEnough, setWideEnough] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth >= 1200;
  });

  useEffect(() => {
    const update = () => setWideEnough(window.innerWidth >= 1200);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  if (populated.length === 0) return null;
  if (!wideEnough) return null;

  return (
    <aside
      data-testid="show-right-rail"
      style={{
        flexShrink: 0,
        width: 320,
        padding: "24px var(--page-pad-x) 48px 0",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {populated.map((node, i) => (
        // eslint-disable-next-line react/no-array-index-key
        <div key={i}>{node}</div>
      ))}
    </aside>
  );
}
