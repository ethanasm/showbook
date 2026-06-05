"use client";

import { useEffect } from "react";

interface DeleteShowConfirmModalProps {
  /** Headliner / title shown in the prompt so the user knows what they're deleting. */
  showName: string;
  /** True while the delete mutation is in flight — disables both buttons. */
  deleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation popup for deleting a show from its detail page.
 *
 * Replaces the native `window.confirm()` with an in-app dialog so the
 * destructive action gets a styled, dismissable prompt with explicit
 * Delete / Cancel options (mirrors the `DeleteAccountModal` pattern in
 * `apps/web/app/(app)/preferences/View.client.tsx`): hand-rolled
 * fixed-position overlay, `role="dialog"`, click-outside + Escape to
 * dismiss. Mobile already has the equivalent via `Alert.alert` in
 * `apps/mobile/components/ShowActionSheet.tsx`.
 */
export function DeleteShowConfirmModal({
  showName,
  deleting,
  onConfirm,
  onCancel,
}: DeleteShowConfirmModalProps) {
  // Escape closes the dialog (unless a delete is already in flight).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !deleting) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleting, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-show-title"
      data-testid="delete-show-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !deleting) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.6)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 12,
          padding: 24,
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <h2
            id="delete-show-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 20,
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            Delete this show?
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--muted)",
            }}
          >
            This removes{" "}
            {showName ? (
              <strong style={{ color: "var(--ink)" }}>{showName}</strong>
            ) : (
              "this show"
            )}
            , its setlists, and any tagged media. This cannot be undone.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            data-testid="delete-show-cancel"
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--ink)",
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              borderRadius: 0,
              padding: "6px 12px",
              cursor: deleting ? "not-allowed" : "pointer",
              letterSpacing: ".06em",
              textTransform: "uppercase",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            data-testid="delete-show-confirm"
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: "#fff",
              background: "#E63946",
              border: "1px solid #E63946",
              borderRadius: 0,
              padding: "6px 12px",
              cursor: deleting ? "not-allowed" : "pointer",
              letterSpacing: ".06em",
              textTransform: "uppercase",
              opacity: deleting ? 0.6 : 1,
            }}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
