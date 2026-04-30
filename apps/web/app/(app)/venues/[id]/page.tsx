"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { EditableName } from "@/components/EditableName";
import {
  Music,
  Clapperboard,
  Laugh,
  Tent,
  MapPin,
  ArrowUpRight,
  Plus,
  Check,
  MoreHorizontal,
  Trash2,
  Ticket,
} from "lucide-react";
import {
  EmptyState,
  RemoteImage,
  ShowRow as ShowRowComponent,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";

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

const KIND_ICONS: Record<
  ShowKind,
  React.ComponentType<{ size?: number; color?: string; className?: string }>
> = {
  concert: Music,
  theatre: Clapperboard,
  comedy: Laugh,
  festival: Tent,
};

const KIND_LABELS: Record<ShowKind, string> = {
  concert: "Concert",
  theatre: "Theatre",
  comedy: "Comedy",
  festival: "Festival",
};

const ON_SALE_STATUS_LABELS: Record<string, string> = {
  announced: "announced",
  on_sale: "on sale",
  sold_out: "sold out",
};

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateParts(dateStr: string): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date(dateStr + "T00:00:00");
  return {
    month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    dow: d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase(),
  };
}

function formatOnSaleDate(value: Date | string | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getHeadliner(show: ShowData): string {
  if ((show.kind === "theatre" || show.kind === "festival") && show.productionName) {
    return show.productionName;
  }
  const hl = show.showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 0,
  );
  return (
    hl?.performer.name ??
    show.showPerformers.find((sp) => sp.role === "headliner")?.performer.name ??
    "Unknown"
  );
}

function daysUntil(dateStr: string): number {
  const now = new Date();
  const d = new Date(dateStr + "T00:00:00");
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

const STATE_TRANSITIONS: Record<string, { label: string; target: ShowState }> = {
  watching: { label: "Got tickets", target: "ticketed" },
  ticketed: { label: "Mark as attended", target: "past" },
};

function getSupport(show: ShowData): string[] {
  return show.showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);
}

function getHeadlinerId(show: ShowData): string | undefined {
  if ((show.kind === "theatre" || show.kind === "festival") && show.productionName) {
    return undefined;
  }
  const hl = show.showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 0,
  );
  return hl?.performer.id;
}

function getHeadlinerImageUrl(show: ShowData): string | null {
  if ((show.kind === "theatre" || show.kind === "festival") && show.productionName) {
    return null;
  }
  const hl = show.showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 0,
  );
  return hl?.performer.imageUrl ?? null;
}

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

function getSupportPerformers(show: ShowData): { id: string; name: string }[] {
  return show.showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => ({ id: sp.performer.id, name: sp.performer.name }));
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
      utils.shows.list.invalidate();
    },
  });

  const deleteShow = trpc.shows.delete.useMutation({
    onSuccess: () => {
      setExpandedShowId(null);
      utils.venues.userShows.invalidate();
      utils.venues.detail.invalidate();
      utils.shows.list.invalidate();
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

      {/* Hero */}
      <div
        style={{
          padding: "28px 36px 24px",
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
          {locationLine && (
            <div
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 14,
                color: "var(--muted)",
                marginTop: 10,
                letterSpacing: -0.1,
              }}
            >
              {locationLine}
            </div>
          )}
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
          </div>
        </div>

        {/* Follow button */}
        <button
          type="button"
          onClick={toggleFollow}
          disabled={followBusy}
          style={{
            padding: "8px 14px",
            border: `1px solid ${venue.isFollowed ? "var(--accent)" : "var(--rule-strong)"}`,
            background: venue.isFollowed ? "var(--accent)" : "transparent",
            color: venue.isFollowed ? "var(--bg)" : "var(--ink)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            letterSpacing: ".04em",
            cursor: followBusy ? "default" : "pointer",
            opacity: followBusy ? 0.6 : 1,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {venue.isFollowed ? (
            <>
              <Check size={12} /> Following
            </>
          ) : (
            <>
              <Plus size={12} /> Follow
            </>
          )}
        </button>
      </div>

      {/* Stat bar */}
      <div
        style={{
          padding: "16px 36px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          columnGap: 28,
        }}
      >
        <Stat label="Your shows" value={String(venue.userShowCount)} />
        <Stat label="Upcoming" value={String(venue.upcomingCount)} />
        <Stat
          label="First seen"
          value={stats.first ? formatDateLong(stats.first) : "—"}
        />
        <Stat
          label="Last seen"
          value={stats.last ? formatDateLong(stats.last) : "—"}
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          padding: "24px 36px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        {/* Scrape config — only for venues not covered by Ticketmaster */}
        {!venue.ticketmasterVenueId && (
          <ScrapeConfigSection venueId={venueId} venueName={venue.name} />
        )}

        {/* Upcoming */}
        <section>
          <SectionHeader
            label={`Upcoming · ${upcoming.length}`}
            note="ascending · soonest first"
          />
          {announcementsQuery.isLoading ? (
            <CardMessage>Loading announcements…</CardMessage>
          ) : upcoming.length === 0 ? (
            <EmptyState
              kind="discover"
              title="Quiet calendar"
              body="No upcoming announcements are attached to this venue yet."
            />
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

        {/* Your shows */}
        <section>
          <SectionHeader
            label={`Your shows · ${userShows.length}`}
            note="newest first"
          />
          {userShowsQuery.isLoading ? (
            <CardMessage>Loading your history…</CardMessage>
          ) : userShows.length === 0 ? (
            <EmptyState
              kind="venues"
              title="No visits logged"
              body="Shows you log at this venue will appear here with seats, spend, and status."
            />
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

        {/* Map link if we have coords */}
        {venue.latitude != null && venue.longitude != null && (
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--muted)",
              letterSpacing: ".04em",
            }}
          >
            <Link
              href={`/map?venue=${venue.id}`}
              data-testid="view-on-map"
              style={{
                color: "var(--muted)",
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              View on map <ArrowUpRight size={11} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function ShowDetailPanel({
  show,
  venueName,
  venueId,
  onEdit,
  onDelete,
  onStateTransition,
}: {
  show: ShowData;
  venueName: string;
  venueId: string;
  onEdit: () => void;
  onDelete: () => void;
  onStateTransition: () => void;
}) {
  const support = getSupport(show);
  const dateParts = formatDateParts(show.date);
  const days = daysUntil(show.date);
  const countdown = show.state !== "past" && days > 0 ? `in ${days} day${days !== 1 ? "s" : ""}` : null;
  const transition = STATE_TRANSITIONS[show.state];

  return (
    <div style={{
      background: "var(--surface2)",
      borderBottom: "1px solid var(--rule)",
      padding: "20px 24px 20px 34px",
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr 1fr",
      gap: 24,
    }}>
      {/* Column 1: Details */}
      <div>
        <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>
          Details
        </div>
        <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 20, fontWeight: 600, color: "var(--ink)", letterSpacing: -0.5, lineHeight: 1.1 }}>
          {(() => {
            const hlId = getHeadlinerId(show);
            const name = getHeadliner(show);
            return hlId ? (
              <Link
                href={`/artists/${hlId}`}
                style={{ color: "inherit", textDecoration: "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
              >
                {name}
              </Link>
            ) : name;
          })()}
        </div>
        {support.length > 0 && (
          <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 12.5, color: "var(--muted)", marginTop: 5 }}>
            with{" "}
            {(() => {
              const supportRich = getSupportPerformers(show);
              return support.map((name, i) => {
                const id = supportRich.find((p) => p.name === name)?.id;
                return (
                  <span key={`${name}-${i}`}>
                    {id ? (
                      <Link
                        href={`/artists/${id}`}
                        style={{ color: "inherit", textDecoration: "none" }}
                        onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                        onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                    {i < support.length - 1 ? ", " : ""}
                  </span>
                );
              });
            })()}
          </div>
        )}
        {show.tourName && (
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", marginTop: 8, letterSpacing: ".04em" }}>
            {show.tourName}
          </div>
        )}
      </div>

      {/* Column 2: Venue */}
      <div>
        <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>
          Venue
        </div>
        <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, color: "var(--ink)" }}>
          {venueName}
        </div>
        {show.seat && (
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
            <span style={{ color: "var(--faint)" }}>seat</span> {show.seat}
          </div>
        )}
      </div>

      {/* Column 3: Date */}
      <div>
        <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 6 }}>
          Date
        </div>
        <div style={{ fontFamily: "var(--font-geist-sans), sans-serif", fontSize: 14, fontWeight: 500, color: "var(--ink)", fontFeatureSettings: '"tnum"' }}>
          {dateParts.dow}, {dateParts.month} {dateParts.day}, {dateParts.year}
        </div>
        {countdown && (
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--accent)", marginTop: 4 }}>
            {countdown}
          </div>
        )}
        {show.pricePaid && (
          <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>
            <span style={{ color: "var(--faint)" }}>paid</span> ${parseFloat(show.pricePaid).toFixed(0)}
            {show.ticketCount > 1 && (
              <span style={{ color: "var(--faint)" }}> · ${(parseFloat(show.pricePaid) / show.ticketCount).toFixed(0)}/ea × {show.ticketCount}</span>
            )}
          </div>
        )}
      </div>

      {/* Column 4: Actions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
        <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 9.5, color: "var(--faint)", letterSpacing: ".1em", textTransform: "uppercase", marginBottom: 2 }}>
          Actions
        </div>
        {show.state === "watching" && (
          <button
            onClick={onStateTransition}
            style={{
              padding: "8px 14px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            <Ticket size={13} /> Buy tickets
          </button>
        )}
        {transition && show.state === "ticketed" && (
          <button
            onClick={onStateTransition}
            style={{
              padding: "8px 14px",
              background: "var(--accent)",
              color: "var(--accent-text)",
              border: "none",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12.5,
              fontWeight: 500,
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              cursor: "pointer",
            }}
          >
            {transition.label}
          </button>
        )}
        <button
          onClick={onEdit}
          style={{
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid var(--rule-strong)",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12.5,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <MoreHorizontal size={13} /> Edit
        </button>
        <button
          onClick={onDelete}
          style={{
            padding: "8px 14px",
            background: "transparent",
            border: "1px solid var(--rule-strong)",
            color: "#E63946",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12.5,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: "pointer",
          }}
        >
          <Trash2 size={13} /> Delete
        </button>
      </div>
    </div>
  );
}

function SectionHeader({ label, note }: { label: string; note?: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--ink)",
          letterSpacing: ".1em",
          textTransform: "uppercase",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      {note && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--faint)",
            letterSpacing: ".04em",
          }}
        >
          {note}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10,
          color: "var(--faint)",
          letterSpacing: ".12em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 22,
          fontWeight: 500,
          color: "var(--ink)",
          letterSpacing: -0.6,
          marginTop: 4,
          fontFeatureSettings: '"tnum"',
        }}
      >
        {value}
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

function formatRelative(d: Date | null | string): string {
  if (!d) return "never";
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "just now";
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function ScrapeConfigSection({
  venueId,
  venueName,
}: {
  venueId: string;
  venueName: string;
}) {
  const utils = trpc.useUtils();
  const statusQuery = trpc.venues.scrapeStatus.useQuery(
    { venueId },
    { enabled: Boolean(venueId) },
  );

  const [url, setUrl] = useState("");
  const [frequency, setFrequency] = useState<number>(7);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (statusQuery.data?.config) {
      setUrl(statusQuery.data.config.url);
      setFrequency(statusQuery.data.config.frequencyDays);
    }
  }, [statusQuery.data]);

  const saveMutation = trpc.venues.saveScrapeConfig.useMutation({
    onSuccess: () => {
      utils.venues.scrapeStatus.invalidate({ venueId });
      setEditing(false);
    },
  });

  const config = statusQuery.data?.config;
  const lastRun = statusQuery.data?.lastRun;
  const hasConfig = !!config;
  const showForm = editing || !hasConfig;

  return (
    <section>
      <SectionHeader
        label="Scrape config"
        note="for venues that aren't on Ticketmaster"
      />
      <div
        style={{
          background: "var(--surface)",
          padding: "16px 20px",
          borderTop: "1px solid var(--rule)",
          borderBottom: "1px solid var(--rule)",
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 13,
          color: "var(--ink)",
        }}
      >
        {!showForm && config ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ wordBreak: "break-all" }}>
              <strong>URL:</strong>{" "}
              <a href={config.url} target="_blank" rel="noreferrer">
                {config.url}
              </a>
            </div>
            <div>
              <strong>Frequency:</strong> every {config.frequencyDays} day
              {config.frequencyDays === 1 ? "" : "s"}
            </div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>
              {lastRun ? (
                <>
                  Last scrape: {formatRelative(lastRun.completedAt ?? lastRun.startedAt)}{" "}
                  {lastRun.status === "success"
                    ? `— ${lastRun.eventsCreated} new events (${lastRun.eventsFound} found)`
                    : lastRun.status === "error"
                      ? `— failed: ${lastRun.errorMessage ?? "unknown error"}`
                      : "— still running"}
                </>
              ) : (
                <>No scrape has run yet — the next weekly run will pick this up.</>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setEditing(true)}
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  padding: "4px 10px",
                  border: "1px solid var(--rule)",
                  background: "transparent",
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      `Stop scraping ${venueName}? You can re-add the URL anytime.`,
                    )
                  ) {
                    saveMutation.mutate({ venueId, config: null });
                  }
                }}
                disabled={saveMutation.isPending}
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  padding: "4px 10px",
                  border: "1px solid var(--rule)",
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!url.trim()) return;
              saveMutation.mutate({
                venueId,
                config: { url: url.trim(), frequencyDays: frequency },
              });
            }}
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>
              Paste the URL of {venueName}&apos;s upcoming-events page. We&apos;ll
              fetch the page weekly and use AI to extract upcoming shows.
            </p>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/upcoming"
              required
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 12,
                padding: "8px 10px",
                border: "1px solid var(--rule)",
                background: "var(--surface2)",
                color: "var(--ink)",
              }}
            />
            <label
              style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}
            >
              Check every
              <select
                value={frequency}
                onChange={(e) => setFrequency(Number(e.target.value))}
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 12,
                  padding: "4px 8px",
                  border: "1px solid var(--rule)",
                  background: "var(--surface2)",
                  color: "var(--ink)",
                }}
              >
                <option value={1}>day</option>
                <option value={7}>week</option>
                <option value={14}>2 weeks</option>
                <option value={30}>month</option>
              </select>
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="submit"
                disabled={saveMutation.isPending || !url.trim()}
                style={{
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  padding: "6px 12px",
                  border: "1px solid var(--accent)",
                  background: "var(--accent)",
                  color: "var(--bg)",
                  cursor: saveMutation.isPending ? "default" : "pointer",
                }}
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
              {hasConfig && (
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  style={{
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 11,
                    padding: "6px 12px",
                    border: "1px solid var(--rule)",
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
            {saveMutation.error && (
              <div style={{ color: "var(--kind-theatre)", fontSize: 12 }}>
                {saveMutation.error.message}
              </div>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
