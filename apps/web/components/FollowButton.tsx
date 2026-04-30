"use client";

import { Plus, Check } from "lucide-react";

type Variant = "sans" | "mono";

interface FollowButtonProps {
  isFollowed: boolean;
  isLoading: boolean;
  onToggle: () => void;
  /**
   * Sans variant matches the larger detail-page hero typography
   * (artist detail). Mono variant matches the venue detail page's
   * monospace typography. The behaviour is identical either way.
   */
  variant?: Variant;
}

export function FollowButton({
  isFollowed,
  isLoading,
  onToggle,
  variant = "sans",
}: FollowButtonProps) {
  const isMono = variant === "mono";
  const iconSize = isMono ? 12 : 13;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isLoading}
      style={{
        padding: "8px 14px",
        border: `1px solid ${
          isFollowed ? "var(--accent)" : "var(--rule-strong)"
        }`,
        background: isFollowed ? "var(--accent)" : "transparent",
        color: isFollowed ? "var(--bg)" : "var(--ink)",
        fontFamily: isMono
          ? "var(--font-geist-mono), monospace"
          : "var(--font-geist-sans), sans-serif",
        fontSize: isMono ? 11 : 12.5,
        fontWeight: isMono ? undefined : 500,
        letterSpacing: isMono ? ".04em" : undefined,
        cursor: isLoading ? "default" : "pointer",
        opacity: isLoading ? 0.6 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      {isFollowed ? (
        <>
          <Check size={iconSize} /> Following
        </>
      ) : (
        <>
          <Plus size={iconSize} /> Follow
        </>
      )}
    </button>
  );
}
