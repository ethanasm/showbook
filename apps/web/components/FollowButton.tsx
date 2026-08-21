"use client";

import { Plus, Check } from "lucide-react";

type Variant = "default" | "compact";

interface FollowButtonProps {
  isFollowed: boolean;
  isLoading: boolean;
  onToggle: () => void;
  /**
   * Default matches the larger detail-page hero typography (artist
   * detail); compact is the smaller treatment the venue detail page
   * uses. The behaviour is identical either way.
   */
  variant?: Variant;
}

export function FollowButton({
  isFollowed,
  isLoading,
  onToggle,
  variant = "default",
}: FollowButtonProps) {
  const isCompact = variant === "compact";
  const iconSize = isCompact ? 12 : 13;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={isLoading}
      style={{
        padding: "8px 14px",
        border: `1px solid ${
          isFollowed ? "var(--ink)" : "var(--rule-strong)"
        }`,
        background: isFollowed ? "var(--ink)" : "transparent",
        color: isFollowed ? "var(--bg)" : "var(--ink)",
        fontFamily: "var(--font-geist-sans), sans-serif",
        fontSize: isCompact ? 12 : 13,
        fontWeight: 500,
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
