"use client";

import { useEffect } from "react";
import { Star, X } from "lucide-react";
import { FestivalLineupPicker } from "./FestivalLineupPicker";
import type { FestivalLineupFlow } from "./useFestivalLineup";

const mono = "var(--font-geist-mono)";

interface FestivalLineupModalProps {
  open: boolean;
  onClose: () => void;
  flow: FestivalLineupFlow;
  /** Footer button label — caller decides the verb (e.g. "Add to show" vs "Save festival"). */
  submitLabel: string;
}

export function FestivalLineupModal({
  open,
  onClose,
  flow,
  submitLabel,
}: FestivalLineupModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isExtracting = flow.phase === "extracting";
  const isError = flow.phase === "error";
  const isPicking =
    flow.phase === "picking" ||
    flow.phase === "submitting" ||
    flow.phase === "done";

  const heading =
    flow.meta?.festivalName ?? (isExtracting ? "Reading poster…" : "Festival lineup");

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: 8,
          width: "100%",
          maxWidth: 560,
          maxHeight: "min(720px, 92vh)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px -12px rgba(0,0,0,.5)",
        }}
      >
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={iconBadgeStyle}>
              <Star size={14} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="display-title" style={titleStyle}>
                {heading}
              </div>
              {flow.meta?.startDate && (
                <div style={subtitleStyle}>
                  {flow.meta.startDate}
                  {flow.meta.endDate && flow.meta.endDate !== flow.meta.startDate
                    ? ` – ${flow.meta.endDate}`
                    : ""}
                  {flow.meta.venueHint ? ` · ${flow.meta.venueHint}` : ""}
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={closeButtonStyle}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
          }}
        >
          {isExtracting && <ExtractingState />}
          {isError && (
            <ErrorState
              message={flow.error ?? "Extraction failed."}
              onRetry={() => {
                flow.reset();
                onClose();
              }}
            />
          )}
          {isPicking && (
            <FestivalLineupPicker
              flow={flow}
              submitLabel={submitLabel}
              compact
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ExtractingState() {
  return (
    <div style={statePanelStyle}>
      <span style={spinnerStyle} aria-hidden />
      <div style={{ fontFamily: mono, fontSize: 11, color: "var(--muted)" }}>
        Reading the poster and pulling artist names…
      </div>
      <style>{spinnerKeyframes}</style>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div style={statePanelStyle}>
      <div
        style={{
          fontFamily: mono,
          fontSize: 12,
          color: "#E63946",
          letterSpacing: ".04em",
          textAlign: "center",
          maxWidth: 340,
        }}
      >
        {message}
      </div>
      <button type="button" onClick={onRetry} style={retryButtonStyle}>
        Close & try again
      </button>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  padding: "16px 20px 12px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderBottom: "1px solid var(--rule)",
  gap: 12,
};
const iconBadgeStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--surface2)",
  border: "1px solid var(--rule)",
  color: "var(--accent)",
  flexShrink: 0,
  borderRadius: 6,
};
const titleStyle: React.CSSProperties = {
  fontSize: 16,
  color: "var(--ink)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const subtitleStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 10.5,
  color: "var(--muted)",
  letterSpacing: ".04em",
  marginTop: 2,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const closeButtonStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--muted)",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 4,
  borderRadius: 4,
};
const statePanelStyle: React.CSSProperties = {
  padding: "36px 28px 32px",
  textAlign: "center",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
};
const spinnerStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: "50%",
  border: "1.5px solid var(--rule-strong)",
  borderTopColor: "var(--accent)",
  display: "inline-block",
  animation: "festival-lineup-spin .9s linear infinite",
};
const retryButtonStyle: React.CSSProperties = {
  fontFamily: mono,
  fontSize: 11,
  fontWeight: 600,
  color: "var(--accent-text)",
  background: "var(--accent)",
  border: "none",
  borderRadius: 0,
  padding: "10px 18px",
  cursor: "pointer",
  letterSpacing: ".08em",
  textTransform: "uppercase",
};
const spinnerKeyframes = `@keyframes festival-lineup-spin { to { transform: rotate(360deg); } }`;
