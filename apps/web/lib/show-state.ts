import type { ShowState } from "@/components/design-system";

// Single source of truth for the per-state action label and target state.
// Used by every page that renders a "Got tickets" / "Mark as attended"
// affordance: shows list, show detail, venue detail, and ShowDetailPanel.
export const STATE_TRANSITIONS: Record<
  string,
  { label: string; target: ShowState }
> = {
  watching: { label: "Got tickets", target: "ticketed" },
  ticketed: { label: "Mark as attended", target: "past" },
};
