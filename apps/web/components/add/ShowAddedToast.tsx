"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import type { FollowSeedEntity } from "@showbook/shared";
import { mono, sans } from "@/app/(app)/add/constants";

export interface ShowAddedToastHandlers {
  onUndo: () => Promise<void> | void;
  onFollowPerformer: (id: string) => Promise<unknown>;
  onFollowVenue: (id: string) => Promise<unknown>;
}

interface ShowAddedToastProps extends ShowAddedToastHandlers {
  toastId: string | number;
  performer: FollowSeedEntity | null;
  venue: FollowSeedEntity | null;
}

type ChipState = "idle" | "pending" | "done";

/**
 * Save confirmation for `shows.create` on the Add page. Keeps the
 * existing Undo affordance and — the follow-seeding hook — offers
 * one-tap follows for the headliner / venue the user just told us
 * about, so Discover stops being a cold start without a separate
 * setup chore.
 *
 * Rendered via `toast.custom`, which mounts outside the app's provider
 * tree — so all data comes in through props/closures and mutations run
 * through the vanilla tRPC client captured by the caller. Local
 * `useState` is fine; tRPC hooks are not.
 */
export function ShowAddedToast({
  toastId,
  performer,
  venue,
  onUndo,
  onFollowPerformer,
  onFollowVenue,
}: ShowAddedToastProps) {
  const [undoing, setUndoing] = useState(false);
  const [performerState, setPerformerState] = useState<ChipState>("idle");
  const [venueState, setVenueState] = useState<ChipState>("idle");

  const hasFollowChips = Boolean(performer || venue);

  const follow = async (
    entity: FollowSeedEntity,
    run: (id: string) => Promise<unknown>,
    setState: (s: ChipState) => void,
  ) => {
    setState("pending");
    try {
      await run(entity.id);
      setState("done");
    } catch {
      setState("idle");
      toast.error(`Couldn't follow ${entity.name} — try again`);
    }
  };

  const chip = (
    entity: FollowSeedEntity,
    state: ChipState,
    onClick: () => void,
  ) => (
    <button
      type="button"
      onClick={onClick}
      disabled={state !== "idle"}
      data-testid="show-added-follow-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 11px",
        borderRadius: 999,
        border: `1px solid ${state === "done" ? "var(--accent)" : "var(--rule-strong)"}`,
        background: "transparent",
        color: state === "done" ? "var(--accent)" : "var(--ink)",
        fontFamily: mono,
        fontSize: 10.5,
        letterSpacing: ".04em",
        cursor: state === "idle" ? "pointer" : "default",
        opacity: state === "pending" ? 0.6 : 1,
        maxWidth: 220,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {state === "done" ? (
        <Check size={11} strokeWidth={2.4} />
      ) : (
        <Plus size={11} strokeWidth={2.4} />
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {state === "done" ? `Following ${entity.name}` : `Follow ${entity.name}`}
      </span>
    </button>
  );

  return (
    <div
      data-testid="show-added-toast"
      style={{
        width: 356,
        maxWidth: "calc(100vw - 32px)",
        background: "var(--surface)",
        color: "var(--ink)",
        border: "1px solid var(--rule-strong)",
        padding: "13px 14px",
        fontFamily: sans,
        fontSize: 13,
        letterSpacing: -0.1,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        position: "relative",
      }}
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => toast.dismiss(toastId)}
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "none",
          border: "none",
          color: "var(--faint)",
          cursor: "pointer",
          padding: 2,
          display: "inline-flex",
        }}
      >
        <X size={13} />
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontWeight: 600 }}>Show added</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={async () => {
            if (undoing) return;
            setUndoing(true);
            try {
              await onUndo();
              toast.dismiss(toastId);
            } finally {
              setUndoing(false);
            }
          }}
          style={{
            background: "none",
            border: "none",
            padding: "2px 14px 2px 4px",
            color: "var(--muted)",
            fontFamily: mono,
            fontSize: 10.5,
            letterSpacing: ".08em",
            textTransform: "uppercase",
            cursor: "pointer",
            opacity: undoing ? 0.5 : 1,
          }}
        >
          {undoing ? "Undoing…" : "Undo"}
        </button>
      </div>
      {hasFollowChips && (
        <>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".04em",
              lineHeight: 1.5,
            }}
          >
            Catch the next one — announcements land in Discover.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {performer &&
              chip(performer, performerState, () =>
                void follow(performer, onFollowPerformer, setPerformerState),
              )}
            {venue &&
              chip(venue, venueState, () =>
                void follow(venue, onFollowVenue, setVenueState),
              )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Fire the save-confirmation toast. Lives next to the component so the
 * `useAddShowForm` call site stays a one-liner.
 */
export function showShowAddedToast(args: {
  performer: FollowSeedEntity | null;
  venue: FollowSeedEntity | null;
  handlers: ShowAddedToastHandlers;
}) {
  toast.custom(
    (t) => (
      <ShowAddedToast
        toastId={t}
        performer={args.performer}
        venue={args.venue}
        {...args.handlers}
      />
    ),
    // Longer than the default 5s — the follow chips are an invitation,
    // not a status line, and need time to be seen after navigation.
    { duration: 10_000 },
  );
}
