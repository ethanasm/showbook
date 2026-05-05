"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Check,
  Pencil,
  Ticket,
  Trash2,
} from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { trpc } from "@/lib/trpc";
import { useInvalidateSidebarCounts } from "@/lib/sidebar-counts";
import { STATE_TRANSITIONS } from "@/lib/show-state";
import { getHeadliner, type ShowLike } from "@/lib/show-accessors";
import type { ShowState } from "@/components/design-system";

export interface ShowForContextMenu extends ShowLike {
  id: string;
  state: ShowState;
  ticketUrl: string | null;
}

interface ContextMenuState<T> {
  show: T;
  position: { x: number; y: number };
}

/**
 * Centralises the right-click menu shown on rows that represent a single show.
 * Used by both the Shows list page and the Home recents rail so menu options,
 * delete confirmation, and the watching → ticketed transition modal stay in
 * lockstep across pages.
 */
export function useShowContextMenu<T extends ShowForContextMenu>() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const invalidateSidebarCounts = useInvalidateSidebarCounts();
  const updateState = trpc.shows.updateState.useMutation();
  const deleteShow = trpc.shows.delete.useMutation();

  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null);
  const [transitionShow, setTransitionShow] = useState<T | null>(null);
  const [transitionSeat, setTransitionSeat] = useState("");
  const [transitionPrice, setTransitionPrice] = useState("");
  const [transitionTicketCount, setTransitionTicketCount] = useState("1");

  const openContextMenu = useCallback((e: React.MouseEvent, show: T) => {
    e.preventDefault();
    setMenu({ show, position: { x: e.clientX, y: e.clientY } });
  }, []);

  const closeContextMenu = useCallback(() => setMenu(null), []);

  const handleDelete = useCallback(
    async (showId: string) => {
      if (!confirm("Delete this show? This cannot be undone.")) return;
      await deleteShow.mutateAsync({ showId });
      utils.shows.invalidate();
      utils.performers.invalidate();
      invalidateSidebarCounts();
    },
    [deleteShow, utils, invalidateSidebarCounts],
  );

  const handleStateTransition = useCallback(
    async (show: T) => {
      const transition = STATE_TRANSITIONS[show.state];
      if (!transition) return;

      if (show.state === "watching") {
        setTransitionShow(show);
        return;
      }

      await updateState.mutateAsync({
        showId: show.id,
        newState: transition.target,
      });
      utils.shows.invalidate();
      invalidateSidebarCounts();
    },
    [updateState, utils, invalidateSidebarCounts],
  );

  const handleTransitionSubmit = useCallback(async () => {
    if (!transitionShow) return;
    const transition = STATE_TRANSITIONS[transitionShow.state];
    if (!transition) return;

    await updateState.mutateAsync({
      showId: transitionShow.id,
      newState: transition.target,
      seat: transitionSeat || undefined,
      pricePaid: transitionPrice || undefined,
      ticketCount: parseInt(transitionTicketCount) || 1,
    });
    setTransitionShow(null);
    setTransitionSeat("");
    setTransitionPrice("");
    setTransitionTicketCount("1");
    utils.shows.invalidate();
    invalidateSidebarCounts();
  }, [
    transitionShow,
    transitionSeat,
    transitionPrice,
    transitionTicketCount,
    updateState,
    utils,
    invalidateSidebarCounts,
  ]);

  const buildItems = useCallback(
    (show: T): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [
        {
          label: "Edit",
          icon: <Pencil size={13} />,
          onClick: () => router.push(`/add?editId=${show.id}`),
        },
        {
          label: "Delete",
          icon: <Trash2 size={13} />,
          onClick: () => handleDelete(show.id),
          danger: true,
        },
      ];

      if (show.state === "ticketed") {
        items.splice(1, 0, {
          label: "Mark as attended",
          icon: <Check size={13} />,
          onClick: () => handleStateTransition(show),
        });
      }

      if (show.state === "watching") {
        items.splice(1, 0, {
          label: "Got tickets",
          icon: <Ticket size={13} />,
          onClick: () => handleStateTransition(show),
        });
      }

      if (show.ticketUrl) {
        items.push({
          label: "Open in Ticketmaster",
          icon: <ArrowUpRight size={13} />,
          onClick: () =>
            window.open(show.ticketUrl!, "_blank", "noopener,noreferrer"),
        });
      }

      return items;
    },
    [router, handleDelete, handleStateTransition],
  );

  const portal = (
    <>
      {menu && (
        <ContextMenu
          items={buildItems(menu.show)}
          position={menu.position}
          onClose={closeContextMenu}
        />
      )}
      {transitionShow && (
        <div
          data-testid="state-transition-modal"
          onClick={() => setTransitionShow(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 200,
            backdropFilter: "blur(4px)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--rule)",
              borderRadius: 12,
              padding: 24,
              width: "100%",
              maxWidth: 400,
              display: "flex",
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontWeight: 700,
                fontSize: "1.1rem",
                color: "var(--ink)",
              }}
            >
              Got tickets for {getHeadliner(transitionShow)}?
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Seat
              </label>
              <input
                value={transitionSeat}
                onChange={(e) => setTransitionSeat(e.target.value)}
                placeholder="e.g., Orchestra Row G Seat 12"
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Total cost
              </label>
              <input
                value={transitionPrice}
                onChange={(e) => setTransitionPrice(e.target.value)}
                placeholder="e.g., 85.00"
                type="number"
                step="0.01"
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Tickets
              </label>
              <input
                value={transitionTicketCount}
                onChange={(e) => setTransitionTicketCount(e.target.value)}
                placeholder="1"
                type="number"
                min="1"
                step="1"
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  background: "var(--bg)",
                  color: "var(--ink)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: "0.9rem",
                  outline: "none",
                }}
              />
            </div>
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <button
                onClick={handleTransitionSubmit}
                disabled={!transitionSeat || updateState.isPending}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  border: "none",
                  background: "var(--accent)",
                  color: "var(--accent-text)",
                  opacity:
                    !transitionSeat || updateState.isPending ? 0.5 : 1,
                }}
              >
                {updateState.isPending ? "Saving..." : "Confirm"}
              </button>
              <button
                onClick={() => setTransitionShow(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 6,
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  border: "1px solid var(--rule)",
                  background: "transparent",
                  color: "var(--muted)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return {
    /** Bind to a row's `onContextMenu`. Calls `preventDefault` internally. */
    openContextMenu,
    /** Render once near the page root — includes the menu and transition modal. */
    portal,
    /** Exposed so callers can build their own menu items if they need to extend. */
    buildItems,
    /** Re-exposed so out-of-menu UI (detail panels, etc.) can share the same behaviour. */
    handleDelete,
    handleStateTransition,
  };
}
