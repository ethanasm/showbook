"use client";

import Link from "next/link";
import { CalendarPlus } from "lucide-react";
import { TicketmasterMark } from "@/components/BrandIcons";
import { DISCOVER_KIND_ICONS as KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { isNonWatchableKind } from "@showbook/shared";
import {
  type Announcement,
  ON_SALE_STATUS_LABELS,
  REASON_LABELS,
  formatOnSaleDate,
  formatRunRange,
  formatShowDateShort,
  isRun,
} from "./types";
import { WatchButton } from "./WatchButton";

/**
 * Single announcement row inside the Discover feed. Layout shifts
 * slightly per `groupBy`:
 *   - `venue` and `artist` show headliner + support
 *   - `region` adds a venue cell between Kind and Headliner
 *   - `artist` swaps the headliner cell for the venue (since the
 *     group header already states the artist).
 * Multi-night runs collapse the date column into a range with a
 * `<count> dates` sub-label.
 */
export function AnnouncementRow({
  announcement,
  isWatching,
  onToggleWatch,
  showReason,
  groupBy,
}: {
  announcement: Announcement;
  isWatching: boolean;
  onToggleWatch: (id: string, watching: boolean) => void;
  showReason: boolean;
  groupBy: "venue" | "artist" | "region";
}) {
  const date = formatShowDateShort(announcement.showDate);
  const KindIcon = KIND_ICONS[announcement.kind];
  const isOnSale =
    announcement.onSaleStatus === "on_sale" ||
    announcement.onSaleStatus === "presale";
  const isSoldOut = announcement.onSaleStatus === "sold_out";
  const isCancelled = announcement.onSaleStatus === "cancelled";
  const runMode = isRun(announcement);
  const runDateLabel =
    runMode && announcement.runStartDate && announcement.runEndDate
      ? formatRunRange(announcement.runStartDate, announcement.runEndDate)
      : null;
  const performanceCount = announcement.performanceDates?.length ?? 0;
  const reasonText =
    announcement.reason && REASON_LABELS[announcement.reason]
      ? REASON_LABELS[announcement.reason]
      : announcement.reason || null;

  return (
    <div
      className={`discover-row discover-row--${announcement.kind} ${isWatching ? "discover-row--watched" : ""} ${runMode ? "discover-row--run" : ""} ${groupBy === "region" ? "discover-row--region" : ""} ${isSoldOut ? "discover-row--sold-out" : ""} ${isCancelled ? "discover-row--cancelled" : ""}`}
    >
      {/* Date */}
      <div>
        {runMode && runDateLabel ? (
          <>
            <div className="discover-row__date-main" title={`${performanceCount} dates`}>
              {runDateLabel}
            </div>
            <div className="discover-row__date-sub">
              {performanceCount} dates
            </div>
          </>
        ) : (
          <>
            <div className="discover-row__date-main">
              {date.month} {date.day}
            </div>
            <div className="discover-row__date-sub">
              {date.year} &middot; {date.dow}
            </div>
          </>
        )}
      </div>

      {/* Kind */}
      <div
        className={`discover-row__kind discover-row__kind--${announcement.kind}`}
      >
        <KindIcon size={12} />
        {KIND_LABELS[announcement.kind]}
      </div>

      {/* Venue (region mode only — separate cell before Headliner) */}
      {groupBy === "region" && (
        <div className="discover-row__venue-cell">
          <div className="discover-row__venue-name">
            <Link
              href={`/venues/${announcement.venue.id}`}
              className="discover-row__headliner-link"
              onClick={(e) => e.stopPropagation()}
            >
              {announcement.venue.name}
            </Link>
          </div>
          {announcement.venue.city && (
            <div className="discover-row__support">
              {announcement.venue.city}
            </div>
          )}
        </div>
      )}

      {/* Headliner / Venue */}
      <div className="discover-row__headliner-cell">
        {groupBy === "artist" ? (
          <>
            <div className="discover-row__headliner">
              <Link
                href={`/venues/${announcement.venue.id}`}
                className="discover-row__headliner-link"
                onClick={(e) => e.stopPropagation()}
              >
                {announcement.venue.name}
              </Link>
            </div>
            {announcement.venue.city && (
              <div className="discover-row__support">
                {announcement.venue.city}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="discover-row__headliner">
              {announcement.headlinerPerformerId ? (
                <Link
                  href={`/artists/${announcement.headlinerPerformerId}`}
                  className="discover-row__headliner-link"
                  onClick={(e) => e.stopPropagation()}
                >
                  {announcement.productionName ?? announcement.headliner}
                </Link>
              ) : (
                announcement.productionName ?? announcement.headliner
              )}
            </div>
            {announcement.support && announcement.support.length > 0 && (
              <div className="discover-row__support">
                {"+"}{" "}
                {announcement.support.join(", ")}
              </div>
            )}
            {showReason && reasonText && (
              <div className="discover-row__reason">{reasonText}</div>
            )}
          </>
        )}
      </div>

      {/* On Sale */}
      <div className="discover-row__onsale-cell">
        <div
          className={`discover-row__onsale ${isOnSale ? "discover-row__onsale--active" : ""}`}
        >
          {formatOnSaleDate(announcement.onSaleDate)}
        </div>
        {announcement.onSaleSoon && (
          <span
            className="discover-row__onsale-soon"
            title="Tickets go on sale within the next week"
          >
            on sale soon
          </span>
        )}
      </div>

      {/* Status */}
      <div className="discover-row__status-cell">
        <span
          className={`discover-row__status-badge discover-row__status-badge--${announcement.onSaleStatus} discover-row__status-badge--${announcement.kind}`}
        >
          {ON_SALE_STATUS_LABELS[announcement.onSaleStatus]}
        </span>
      </div>

      {/* Actions */}
      <div className="discover-row__actions">
        {!isNonWatchableKind(announcement.kind) && (
          <WatchButton
            announcementId={announcement.id}
            isWatching={isWatching}
            onToggle={onToggleWatch}
          />
        )}
        <a
          href={`/api/announcements/${announcement.id}/ical`}
          download
          data-testid="add-to-calendar"
          className="discover-tix-btn"
          onClick={(e) => e.stopPropagation()}
        >
          <CalendarPlus size={11} />
          Calendar
        </a>
        {announcement.ticketUrl ? (
          <a
            href={announcement.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open tickets on Ticketmaster"
            title="Open in Ticketmaster"
            className="discover-tix-btn discover-tix-btn--icon-only"
            onClick={(e) => e.stopPropagation()}
          >
            <TicketmasterMark size={12} />
          </a>
        ) : (
          <span
            aria-hidden="true"
            className="discover-tix-btn discover-tix-btn--icon-only discover-tix-btn--placeholder"
          >
            <TicketmasterMark size={12} />
          </span>
        )}
      </div>
    </div>
  );
}
