"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { EditableName } from "@/components/EditableName";
import {
  Music,
  ArrowUpRight,
  MoreHorizontal,
  Trash2,
  Ticket,
} from "lucide-react";
import { FollowButton } from "@/components/FollowButton";
import { ShowDetailPanel } from "@/components/ShowDetailPanel";
import { ScrapeConfigSection } from "@/components/ScrapeConfigSection";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import {
  getHeadliner,
  getHeadlinerId,
  getHeadlinerImageUrl,
  getSupport,
  getSupportPerformers,
} from "@/lib/show-accessors";
import {
  RemoteImage,
  SectionHeader,
  ShowRow as ShowRowComponent,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";
import { MediaSection } from "@/components/media";
import {
  daysUntil,
  formatDateMedium as formatDateLong,
  formatDateParts,
  formatOnSaleDate,
} from "@showbook/shared";

type Performer = {
  id: string;
  name: string;
  imageUrl: string | null;
};

type ShowPerformer = {
  role: string;
  characterName: string | null;
  sortOrder: number;
  performer: Performer;
};

type ShowData = {
  id: string;
  kind: ShowKind;
  state: ShowState;
  date: string;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  showPerformers: ShowPerformer[];
};

const ON_SALE_STATUS_LABELS: Record<string, string> = {
  announced: "announced",
  on_sale: "on sale",
  sold_out: "sold out",
};

const STATE_TRANSITIONS: Record<string, { label: string; target: ShowState }> = {
  watching: { label: "Got tickets", target: "ticketed" },
  ticketed: { label: "Mark as attended", target: "past" },
};

function gradientLastWord(name: string) {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return <span className="gradient-emphasis">{name}</span>;
  const last = words.pop();
  return (
    <>
      {words.join(" ")} <span className="gradient-emphasis">{last}</span>
    </>
  );
}

export default function VenueDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const venueId = params?.id ?? "";

  const utils = trpc.useUtils();

  const detailQuery = trpc.venues.detail.useQuery(
    { venueId },
    { enabled: Boolean(venueId) },
  );
  const announcementsQuery = trpc.venues.upcomingAnnouncements.useQuery(
    { venueId, limit: 100 },
    { enabled: Boolean(venueId) },
  );
  const userShowsQuery = trpc.venues.userShows.useQuery(
    { venueId },
    { enabled: Boolean(venueId) },
  );

  const followMutation = trpc.venues.follow.useMutation({
    onSuccess: () => {
      utils.venues.detail.invalidate({ venueId });
      utils.venues.followed.invalidate();
      utils.discover.followedFeed.invalidate();
      utils.discover.nearbyFeed.invalidate();
    },
  });

  const unfollowMutation = trpc.venues.unfollow.useMutation({
    onSuccess: (data) => {
      if (data.deleted) {
        router.push("/venues");
        return;
      }
      utils.venues.detail.invalidate({ venueId });
      utils.venues.followed.invalidate();
      utils.discover.followedFeed.invalidate();
      utils.discover.nearbyFeed.invalidate();
    },
  });

  const renameMutation = trpc.venues.rename.useMutation({
    onSuccess: () => {
      utils.venues.detail.invalidate();
    },
  });

  const updateState = trpc.shows.updateState.useMutation({
    onSuccess: () => {
      utils.venues.userShows.invalidate();
      utils.venues.detail.invalidate();
      utils.shows.invalidate();
    },
  });

  const deleteShow = trpc.shows.delete.useMutation({
    onSuccess: () => {
      setExpandedShowId(null);
      utils.venues.userShows.invalidate();
      utils.venues.detail.invalidate();
      utils.shows.invalidate();
    },
  });

  const [expandedShowId, setExpandedShowId] = useState<string | null>(null);

  const venue = detailQuery.data;
  const userShows = useMemo(
    () => (userShowsQuery.data ?? []) as ShowData[],
    [userShowsQuery.data],
  );
  const upcoming = announcementsQuery.data ?? [];

  const stats = useMemo(() => {
    const sorted = [...userShows].sort((a, b) => a.date.localeCompare(b.date));
    const first = sorted[0]?.date ?? null;
    const last = sorted[sorted.length - 1]?.date ?? null;
    return { first, last };
  }, [userShows]);

  const followBusy =
    followMutation.isPending || unfollowMutation.isPending;

  function toggleFollow() {
    if (!venue || followBusy) return;
    if (venue.isFollowed) {
      unfollowMutation.mutate({ venueId: venue.id });
    } else {
      followMutation.mutate({ venueId: venue.id });
    }
  }

  function handleRowClick(showId: string) {
    setExpandedShowId((prev) => (prev === showId ? null : showId));
  }

  async function handleDelete(showId: string) {
    if (!confirm("Delete this show? This cannot be undone.")) return;
    await deleteShow.mutateAsync({ showId });
  }

  async function handleStateTransition(show: ShowData) {
    const transition = STATE_TRANSITIONS[show.state];
    if (!transition) return;
    await updateState.mutateAsync({
      showId: show.id,
      newState: transition.target,
    });
  }

  if (detailQuery.isLoading) {
    return <CenteredMessage>Loading venue…</CenteredMessage>;
  }

  if (detailQuery.error || !venue) {
    return (
      <CenteredMessage tone="error">
        Couldn&apos;t load venue.{" "}
        <button
          type="button"
          onClick={() => router.push("/discover")}
          style={{
            background: "none",
            border: "none",
            color: "var(--accent)",
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "inherit",
            padding: 0,
            marginLeft: 8,
          }}
        >
          back to discover →
        </button>
      </CenteredMessage>
    );
  }

  const locationLine = [
    venue.city,
    venue.stateRegion,
    venue.country,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Breadcrumb */}
      <div
        style={{
          padding: "14px 36px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--muted)",
          letterSpacing: ".04em",
        }}
      >
        <Link href="/venues" style={{ color: "var(--muted)", textDecoration: "none" }}>← venues</Link>
        <span style={{ color: "var(--faint)" }}>/</span>
        <span style={{ color: "var(--ink)" }}>{venue.name.toLowerCase()}</span>
      </div>

      <div style={{ padding: "24px 36px 0" }}>
        <div className="venue-photo-band">
          {venue.photoUrl ? (
            <RemoteImage
              src={`/api/venue-photo/${venue.id}`}
              alt={`${venue.name} venue photo`}
              kind="venue"
              name={venue.name}
              aspect="16/9"
              size="hero"
              priority
            />
          ) : (
            <div style={{ position: "absolute", inset: 0 }}>
              <div className="glow-backdrop" />
            </div>
          )}
          <div className="venue-photo-band__fade" />
        </div>
      </div>

      {/* Hero — title + compact inline meta + actions on right */}
      <div
        style={{
          padding: "20px 36px 18px",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          columnGap: 32,
          alignItems: "end",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">Venue</div>
          <EditableName
            value={venue.name}
            displayValue={gradientLastWord(venue.name)}
            onSave={(name) => renameMutation.mutate({ venueId: venue.id, name })}
          />
          {/* Compact meta line: location · visit count · first/last seen · upcoming */}
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11.5,
              color: "var(--muted)",
              marginTop: 8,
              letterSpacing: ".02em",
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              columnGap: 10,
              rowGap: 4,
            }}
          >
            {locationLine && (
              <span style={{ color: "var(--ink)" }}>{locationLine}</span>
            )}
            {locationLine && <span style={{ color: "var(--faint)" }}>·</span>}
            <span>
              <span style={{ color: "var(--ink)" }}>
                {venue.userShowCount}
              </span>{" "}
              {venue.userShowCount === 1 ? "visit" : "visits"}
            </span>
            {stats.first && (
              <>
                <span style={{ color: "var(--faint)" }}>·</span>
                <span>
                  {stats.first === stats.last
                    ? formatDateLong(stats.first)
                    : `${formatDateLong(stats.first)} – ${formatDateLong(stats.last!)}`}
                </span>
              </>
            )}
            <span style={{ color: "var(--faint)" }}>·</span>
            <span>
              <span
                style={{
                  color: venue.upcomingCount > 0 ? "var(--accent)" : "var(--muted)",
                }}
              >
                {venue.upcomingCount}
              </span>{" "}
              upcoming
            </span>
          </div>
          {/* Source-link chips */}
          <div style={{ display: "inline-flex", gap: 8, marginTop: 10 }}>
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                border: `1px solid ${venue.ticketmasterVenueId ? "var(--accent)" : "var(--faint)"}`,
                color: venue.ticketmasterVenueId ? "var(--accent)" : "var(--faint)",
              }}
            >
              {venue.ticketmasterVenueId ? "TM linked" : "No TM ID"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                border: `1px solid ${venue.googlePlaceId ? "var(--kind-concert)" : "var(--faint)"}`,
                color: venue.googlePlaceId ? "var(--kind-concert)" : "var(--faint)",
              }}
            >
              {venue.googlePlaceId ? "Places linked" : "No Place ID"}
            </span>
            {venue.latitude != null && venue.longitude != null && (
              <Link
                href={`/map?venue=${venue.id}`}
                data-testid="view-on-map"
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 10,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  padding: "3px 8px",
                  border: "1px solid var(--rule-strong)",
                  color: "var(--muted)",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                View on map <ArrowUpRight size={10} />
              </Link>
            )}
          </div>
        </div>

        <FollowButton
          isFollowed={venue.isFollowed}
          isLoading={followBusy}
          onToggle={toggleFollow}
          variant="mono"
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          padding: "20px 36px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        {/* Scrape config — only for venues not covered by Ticketmaster */}
        {!venue.ticketmasterVenueId && (
          <ScrapeConfigSection venueId={venueId} venueName={venue.name} />
        )}

        {/* Your shows — show this FIRST. The user's own history is the
            primary content of this page; upcoming announcements are
            secondary discovery. */}
        <section>
          <SectionHeader
            label={`Your shows · ${userShows.length}`}
            note={userShows.length > 0 ? "newest first" : undefined}
          />
          {userShowsQuery.isLoading ? (
            <CardMessage>Loading your history…</CardMessage>
          ) : userShows.length === 0 ? (
            <CardMessage>
              No visits logged here yet. Shows you log at this venue will
              appear with seats, spend, and status.
            </CardMessage>
          ) : (
            <div style={{ background: "var(--surface)" }}>
              {/* Column headers */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "14px 32px 80px 110px 1.2fr 1fr 110px 64px 88px",
                columnGap: 16,
                padding: "10px 20px 10px 10px",
                borderBottom: "1px solid var(--rule)",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 9.5,
                color: "var(--faint)",
                letterSpacing: ".12em",
                textTransform: "uppercase",
              }}>
                <div />
                <div />
                <div>Date</div>
                <div>Kind</div>
                <div>Headline</div>
                <div>Venue</div>
                <div>Seat</div>
                <div style={{ textAlign: "right" }}>Paid</div>
                <div style={{ textAlign: "right" }}>State</div>
              </div>
              {userShows.map((s) => (
                <div key={s.id}>
                  <ShowRowComponent
                    show={{
                      kind: s.kind,
                      state: s.state,
                      headliner: getHeadliner(s),
                      headlinerId: getHeadlinerId(s),
                      imageUrl: getHeadlinerImageUrl(s),
                      support: getSupport(s),
                      supportPerformers: getSupportPerformers(s),
                      venue: venue.name,
                      venueId: venue.id,
                      showId: s.id,
                      date: formatDateParts(s.date),
                      seat: s.seat ?? undefined,
                      paid: s.pricePaid ? parseFloat(s.pricePaid) : undefined,
                      ticketCount: s.ticketCount,
                    }}
                    selected={expandedShowId === s.id}
                    onExpandToggle={() => handleRowClick(s.id)}
                  />
                  {expandedShowId === s.id && (
                    <ShowDetailPanel
                      show={s}
                      venueName={venue.name}
                      venueId={venue.id}
                      onEdit={() => router.push(`/add?editId=${s.id}`)}
                      onDelete={() => handleDelete(s.id)}
                      onStateTransition={() => handleStateTransition(s)}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <MediaSection scope="venue" venueId={venue.id} />

        {/* Upcoming announcements — secondary; render as discovery feed */}
        <section>
          <SectionHeader
            label={`Upcoming · ${upcoming.length}`}
            note={upcoming.length > 0 ? "ascending · soonest first" : undefined}
          />
          {announcementsQuery.isLoading ? (
            <CardMessage>Loading announcements…</CardMessage>
          ) : upcoming.length === 0 ? (
            <CardMessage>
              No upcoming announcements yet. New shows from this venue will
              appear here as they go on sale.
            </CardMessage>
          ) : (
            <div style={{ background: "var(--surface)" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 110px 1fr 110px 120px",
                  columnGap: 16,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--rule)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 9.5,
                  color: "var(--faint)",
                  letterSpacing: ".12em",
                  textTransform: "uppercase",
                }}
              >
                <div>Show date</div>
                <div>Kind</div>
                <div>Headliner</div>
                <div>On sale</div>
                <div>Status</div>
              </div>
              {upcoming.map((a) => {
                const date = formatDateParts(a.showDate);
                const KindIcon = KIND_ICONS[a.kind as ShowKind] ?? Music;
                const isOnSale = a.onSaleStatus === "on_sale";
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "100px 110px 1fr 110px 120px",
                      columnGap: 16,
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--rule)",
                      alignItems: "center",
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 12,
                          color: "var(--ink)",
                          letterSpacing: ".02em",
                          fontFeatureSettings: '"tnum"',
                        }}
                      >
                        {date.month} {date.day}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 10,
                          color: "var(--muted)",
                          marginTop: 2,
                          textTransform: "lowercase",
                        }}
                      >
                        {date.year} &middot; {date.dow}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10.5,
                        color: `var(--kind-${a.kind})`,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      <KindIcon size={12} />
                      {KIND_LABELS[a.kind as ShowKind] ?? a.kind}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      {a.headlinerPerformerId ? (
                        <Link
                          href={`/artists/${a.headlinerPerformerId}`}
                          style={{
                            fontFamily: "var(--font-geist-sans), sans-serif",
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--ink)",
                            letterSpacing: -0.2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            textDecoration: "none",
                            display: "block",
                          }}
                        >
                          {a.headliner}
                        </Link>
                      ) : (
                        <div
                          style={{
                            fontFamily: "var(--font-geist-sans), sans-serif",
                            fontSize: 14,
                            fontWeight: 500,
                            color: "var(--ink)",
                            letterSpacing: -0.2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {a.headliner}
                        </div>
                      )}
                      {a.support && a.support.length > 0 && (
                        <div
                          style={{
                            fontFamily: "var(--font-geist-mono), monospace",
                            fontSize: 10.5,
                            color: "var(--muted)",
                            marginTop: 2,
                          }}
                        >
                          + {a.support.join(", ")}
                        </div>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 11,
                        color: isOnSale ? "var(--accent)" : "var(--muted)",
                        fontWeight: isOnSale ? 500 : 400,
                      }}
                    >
                      {formatOnSaleDate(a.onSaleDate)}
                    </div>
                    <div>
                      <span
                        style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 10,
                          color: "var(--ink)",
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                          padding: "3px 8px",
                          border: `1px solid var(--kind-${a.kind})`,
                        }}
                      >
                        {ON_SALE_STATUS_LABELS[a.onSaleStatus] ?? a.onSaleStatus}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

      </div>
    </div>
  );
}


function CardMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "24px 16px",
        background: "var(--surface)",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: "var(--muted)",
        letterSpacing: ".04em",
      }}
    >
      {children}
    </div>
  );
}

function CenteredMessage({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 300,
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: "0.85rem",
        color: tone === "error" ? "var(--kind-theatre)" : "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}

// ── Scrape config section ─────────────────────────────────────────────────

