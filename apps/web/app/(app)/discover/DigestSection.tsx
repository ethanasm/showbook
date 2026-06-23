"use client";

import { EmptyState } from "@/components/design-system";
import { type Announcement } from "./types";
import { DIGEST_REASON_HEADERS, groupDigestByReason } from "./grouping";
import { AnnouncementRow } from "./AnnouncementRow";

/**
 * The Discover "New for you" tab body — renders the user's daily-digest
 * snapshot (the same set the digest email is built from) grouped into reason
 * sections ("At venues you follow" / "By artists you follow" / "Near you").
 *
 * Read-only: unlike `FeedSection` there are no follow rails / unfollow
 * actions, so the row layout is the plain `groupBy="venue"` variant with the
 * per-row reason chip suppressed (the section header carries the reason). The
 * snapshot only refreshes when the daily digest job runs (08:00 ET), so the
 * empty state nudges the user to check back rather than implying they should
 * follow something.
 */
export function DigestSection({
  items,
  isLoading,
  watchedIds,
  onToggleWatch,
  emptyMessage,
}: {
  items: Announcement[] | undefined;
  isLoading: boolean;
  watchedIds: Set<string>;
  onToggleWatch: (id: string, watching: boolean) => void;
  emptyMessage?: string;
}) {
  const sections = groupDigestByReason(items ?? []);

  if (isLoading && !items) {
    return (
      <div className="discover-feed" aria-busy="true">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 96,
              borderBottom: "1px solid var(--rule)",
              background: "var(--surface)",
              padding: "16px 20px",
              display: "grid",
              gridTemplateColumns: "1fr",
              alignContent: "center",
              gap: 8,
            }}
          >
            <div style={{ height: 14, width: "40%", background: "var(--rule)" }} />
            <div style={{ height: 12, width: "65%", background: "var(--rule)" }} />
            <div style={{ height: 10, width: "25%", background: "var(--rule)" }} />
          </div>
        ))}
      </div>
    );
  }

  if (sections.length === 0) {
    return (
      <div className="discover-feed">
        <div className="discover-empty">
          <EmptyState
            kind="discover"
            title="Nothing new for you yet"
            body={
              emptyMessage ??
              "Your personalized feed refreshes each morning. Check back after the 08:00 ET digest — new shows at the venues, artists, and regions you follow will show up here."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="discover-feed">
      {sections.map(({ reason, items: sectionItems }) => (
        <div key={reason} className="discover-venue-group">
          <div className="discover-venue-group__header">
            <span className="discover-venue-group__name">
              {DIGEST_REASON_HEADERS[reason]}
            </span>
            <span className="discover-venue-group__meta">
              {sectionItems.length} new
            </span>
            <div className="discover-venue-group__rule" />
          </div>
          <div>
            {sectionItems.map((item) => (
              <AnnouncementRow
                key={item.id}
                announcement={item}
                isWatching={watchedIds.has(item.id)}
                onToggleWatch={onToggleWatch}
                showReason={false}
                groupBy="venue"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
