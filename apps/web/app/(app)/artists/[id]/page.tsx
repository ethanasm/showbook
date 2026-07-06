"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { ChevronLeft, Music } from "lucide-react";
import { KIND_ICONS, KIND_LABELS } from "@/lib/kind-icons";
import { FollowButton } from "@/components/FollowButton";
import { useSpotifyConnection } from "@/components/spotify/useSpotifyConnection";
import { useIsMobile } from "@/lib/useIsMobile";
import {
  CenteredMessage,
  EmptyState,
  QueryBoundary,
  RemoteImage,
  SectionHeader,
  ShowRow as ShowRowComponent,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";
import { EditableName } from "@/components/EditableName";
import { MediaSection } from "@/components/media";
import { SpotifyMark } from "@/components/BrandIcons";
import {
  formatDateMedium as formatDateLong,
  formatDateParts,
  formatOnSaleDate,
  InputMaxLength,
} from "@showbook/shared";
import {
  getHeadliner,
  getHeadlinerId,
  getHeadlinerImageUrl,
  getSupport,
  getSupportPerformers,
} from "@/lib/show-accessors";

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

type Venue = {
  id: string;
  name: string;
  city: string | null;
  stateRegion: string | null;
  country: string | null;
};

type ShowData = {
  id: string;
  kind: ShowKind;
  state: ShowState;
  date: string | null;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  venue: Venue;
  showPerformers: ShowPerformer[];
};

function formatShowDateParts(show: ShowData): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const start = formatDateParts(show.date);
  if (
    show.kind !== "festival" ||
    !show.date ||
    !show.endDate ||
    show.endDate === show.date
  ) {
    return start;
  }

  const end = formatDateParts(show.endDate);
  return {
    month: start.month,
    day: `${start.day}-${end.day}`,
    year: start.year,
    dow: `${start.dow}-${end.dow}`,
  };
}

const ON_SALE_STATUS_LABELS: Record<string, string> = {
  announced: "announced",
  presale: "presale",
  on_sale: "on sale",
  sold_out: "sold out",
  cancelled: "cancelled",
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

export default function ArtistDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const isMobile = useIsMobile();
  const performerId = params?.id ?? "";

  const utils = trpc.useUtils();
  const { connection } = useSpotifyConnection();

  const detailQuery = trpc.performers.detail.useQuery(
    { performerId },
    { enabled: Boolean(performerId) },
  );

  const userShowsQuery = trpc.performers.userShows.useQuery(
    { performerId },
    { enabled: Boolean(performerId) },
  );

  const upcomingQuery = trpc.performers.upcomingAnnouncements.useQuery(
    { performerId, limit: 100 },
    { enabled: Boolean(performerId) },
  );

  // Phase 2 — Songs section. The list is bounded server-side; only
  // request the top 25 frequencies. Hide the section when there are
  // no rows so artists with no setlist data don't render an empty
  // chrome.
  const songsQuery = trpc.songs.list.useQuery(
    { performerId, limit: 25 },
    { enabled: Boolean(performerId), staleTime: 60_000 },
  );

  const followMutation = trpc.performers.follow.useMutation({
    meta: { successToast: "Following artist" },
    onMutate: async ({ performerId: id }) => {
      await utils.performers.detail.cancel({ performerId: id });
      const prev = utils.performers.detail.getData({ performerId: id });
      if (prev) {
        utils.performers.detail.setData({ performerId: id }, { ...prev, isFollowed: true });
      }
      return { prev };
    },
    onError: (_err, { performerId: id }, ctx) => {
      if (ctx?.prev) utils.performers.detail.setData({ performerId: id }, ctx.prev);
    },
    onSettled: () => {
      utils.performers.detail.invalidate({ performerId });
      utils.performers.followed.invalidate();
    },
  });

  const unfollowMutation = trpc.performers.unfollow.useMutation({
    meta: { successToast: "Unfollowed artist" },
    onMutate: async ({ performerId: id }) => {
      await utils.performers.detail.cancel({ performerId: id });
      const prev = utils.performers.detail.getData({ performerId: id });
      if (prev) {
        utils.performers.detail.setData({ performerId: id }, { ...prev, isFollowed: false });
      }
      return { prev };
    },
    onError: (_err, { performerId: id }, ctx) => {
      if (ctx?.prev) utils.performers.detail.setData({ performerId: id }, ctx.prev);
    },
    onSettled: () => {
      utils.performers.detail.invalidate({ performerId });
      utils.performers.followed.invalidate();
    },
  });

  const renameMutation = trpc.performers.rename.useMutation({
    onSuccess: () => {
      utils.performers.detail.invalidate();
      utils.performers.invalidate();
    },
  });

  const userShows = useMemo(
    () => (userShowsQuery.data ?? []) as ShowData[],
    [userShowsQuery.data],
  );
  const upcoming = upcomingQuery.data ?? [];

  const stats = useMemo(() => {
    const sorted = [...userShows]
      .filter((show) => show.date)
      .sort((a, b) => a.date!.localeCompare(b.date!));
    return {
      first: sorted[0]?.date ?? null,
      last: sorted[sorted.length - 1]?.date ?? null,
    };
  }, [userShows]);

  const followBusy =
    followMutation.isPending || unfollowMutation.isPending;

  function toggleFollow() {
    const performer = detailQuery.data;
    if (!performer || followBusy) return;
    if (performer.isFollowed) {
      unfollowMutation.mutate({ performerId: performer.id });
    } else {
      followMutation.mutate({ performerId: performer.id });
    }
  }

  return (
    <QueryBoundary
      query={detailQuery}
      loadingLabel="Loading artist…"
      errorFallback={() => (
        <CenteredMessage tone="error">
          Couldn&apos;t load artist.{" "}
          <button
            type="button"
            onClick={() => router.push("/artists")}
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
            back to artists →
          </button>
        </CenteredMessage>
      )}
    >
      {(performer) => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Breadcrumb */}
      <div
        style={{
          padding: "14px var(--page-pad-x)",
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
        <Link
          href="/artists"
          style={{
            color: "var(--muted)",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <ChevronLeft size={12} /> artists
        </Link>
        <span style={{ color: "var(--faint)" }}>/</span>
        <span style={{ color: "var(--ink)" }}>
          {performer.name.toLowerCase()}
        </span>
      </div>

      {/* Hero */}
      <div
        style={{
          padding: isMobile
            ? "20px var(--page-pad-x) 18px"
            : "28px var(--page-pad-x) 24px",
          borderBottom: "1px solid var(--rule)",
          display: isMobile ? "flex" : "grid",
          flexDirection: isMobile ? "column" : undefined,
          gridTemplateColumns: isMobile ? undefined : "1fr auto",
          columnGap: 32,
          rowGap: isMobile ? 14 : undefined,
          alignItems: isMobile ? "stretch" : "end",
        }}
      >
        <div
          style={{
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: isMobile ? 14 : 20,
          }}
        >
          <RemoteImage
            src={`/api/performer-photo/${performer.id}`}
            alt={`${performer.name} portrait`}
            kind="artists"
            name={performer.name}
            aspect="square"
            size="card"
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="eyebrow">Performers you&apos;ve seen live</div>
            <EditableName
              value={performer.name}
              displayValue={gradientLastWord(performer.name)}
              onSave={(name) =>
                renameMutation.mutate({ performerId: performer.id, name })
              }
              compact={isMobile}
              maxLength={InputMaxLength.performerName}
            />
          </div>
        </div>

        <div
          style={{
            alignSelf: isMobile ? "flex-start" : "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <FollowButton
            isFollowed={performer.isFollowed}
            isLoading={followBusy}
            onToggle={toggleFollow}
          />
          {performer.spotifyArtistId &&
            connection.status === "connected" && (
              <OpenInSpotifyButton
                spotifyArtistId={performer.spotifyArtistId}
                performerName={performer.name}
              />
            )}
        </div>
      </div>

      {/* Stat strip */}
      <div
        style={{
          padding: "16px var(--page-pad-x)",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: isMobile
            ? "repeat(2, 1fr)"
            : "repeat(4, 1fr)",
          columnGap: isMobile ? 12 : 28,
          rowGap: isMobile ? 12 : 0,
        }}
      >
        <Stat label="Your shows" value={String(performer.showCount)} />
        <Stat
          label="First seen"
          value={stats.first ? formatDateLong(stats.first) : "—"}
        />
        <Stat
          label="Last seen"
          value={stats.last ? formatDateLong(stats.last) : "—"}
        />
        <Stat
          label="Upcoming"
          value={
            <span
              style={{
                color: upcoming.length > 0 ? "var(--accent)" : "var(--ink)",
              }}
            >
              {upcoming.length}
            </span>
          }
        />
      </div>

      {/* Body */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          background: "var(--bg)",
          padding: "24px var(--page-pad-x) 48px",
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <UpcomingShows
          upcoming={upcoming}
          isLoading={upcomingQuery.isLoading}
          isMobile={isMobile}
        />

        <MediaSection scope="performer" performerId={performer.id} />

        {(songsQuery.data?.length ?? 0) > 0 && (
          <section data-testid="artist-songs-section">
            <SectionHeader
              label={`Songs you've heard live · ${songsQuery.data!.length}`}
              note="top by count"
            />
            <div style={{ background: "var(--surface)" }}>
              {songsQuery.data!.map((row) => (
                <Link
                  key={row.songId}
                  href={`/songs/${row.songId}`}
                  data-testid="artist-songs-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 50px 70px",
                    columnGap: 16,
                    padding: "12px 20px",
                    borderBottom: "1px solid var(--rule)",
                    alignItems: "baseline",
                    color: "inherit",
                    textDecoration: "none",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: 14,
                        color: "var(--ink)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {row.title}
                    </span>
                    {row.isUserDebut && (
                      <span
                        title="You heard this song live exactly once"
                        style={{
                          fontFamily:
                            "var(--font-geist-mono), monospace",
                          fontSize: 9.5,
                          color: "var(--accent)",
                          letterSpacing: ".04em",
                          padding: "1px 6px",
                          border: "1px solid var(--accent)",
                        }}
                      >
                        🆕 Once
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 12,
                      fontWeight: 500,
                      color:
                        row.timesHeard > 1
                          ? "var(--ink)"
                          : "var(--faint)",
                      fontFeatureSettings: '"tnum"',
                    }}
                  >
                    {row.timesHeard}×
                  </div>
                  <div
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 11,
                      color: "var(--muted)",
                      letterSpacing: ".02em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {formatDateLong(row.lastHeard)}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionHeader
            label={`Your shows · ${userShows.length}`}
            note="newest first"
          />
          {userShowsQuery.isLoading ? (
            <CardMessage>Loading your history…</CardMessage>
          ) : userShows.length === 0 ? (
            <EmptyState
              kind="artists"
              title="No shows logged"
              body="When this artist appears in your history, every visit will collect here."
            />
          ) : (
            <div style={{ background: "var(--surface)" }}>
              {!isMobile && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "14px 32px 80px 110px 1.2fr 1fr 110px 64px 88px",
                    columnGap: 16,
                    padding: "10px 20px 10px 10px",
                    borderBottom: "1px solid var(--rule)",
                    fontFamily: "var(--font-geist-mono), monospace",
                    fontSize: 9.5,
                    color: "var(--faint)",
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                  }}
                >
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
              )}
              {userShows.map((s) => (
                <ShowRowComponent
                  key={s.id}
                  show={{
                    kind: s.kind,
                    state: s.state,
                    headliner: getHeadliner(s),
                    headlinerId: getHeadlinerId(s),
                    imageUrl: getHeadlinerId(s)
                      ? `/api/performer-photo/${getHeadlinerId(s)}`
                      : getHeadlinerImageUrl(s),
                    support: getSupport(s),
                    supportPerformers: getSupportPerformers(s),
                    venue: s.venue.name,
                    venueId: s.venue.id,
                    showId: s.id,
                    date: formatShowDateParts(s),
                    seat: s.seat ?? undefined,
                    paid: s.pricePaid ? parseFloat(s.pricePaid) : undefined,
                    ticketCount: s.ticketCount,
                  }}
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
      )}
    </QueryBoundary>
  );
}

type UpcomingRow = {
  id: string;
  ephemeral: boolean;
  kind: string;
  headliner: string;
  headlinerPerformerId: string | null;
  support: string[] | null;
  productionName: string | null;
  showDate: string;
  onSaleStatus: string;
  onSaleDate: Date | string | null;
  ticketUrl: string | null;
  venue: {
    id: string | null;
    name: string;
    city: string | null;
    stateRegion: string | null;
  };
};

function UpcomingShows({
  upcoming,
  isLoading,
  isMobile,
}: {
  upcoming: UpcomingRow[];
  isLoading: boolean;
  isMobile: boolean;
}) {
  const gridColumns = isMobile
    ? "58px minmax(0, 1fr) 84px"
    : "100px 104px 1.3fr 1fr 104px 104px";
  return (
    <section data-testid="artist-upcoming-section">
      <SectionHeader
        label={`Upcoming · ${upcoming.length}`}
        note={upcoming.length > 0 ? "ascending · soonest first" : undefined}
      />
      {isLoading ? (
        <CardMessage>Loading upcoming shows…</CardMessage>
      ) : upcoming.length === 0 ? (
        <CardMessage>
          No upcoming shows on sale. New dates for this artist will appear
          here as they&apos;re announced.
        </CardMessage>
      ) : (
        <div style={{ background: "var(--surface)" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: gridColumns,
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
            <div>Date</div>
            {!isMobile && <div>Kind</div>}
            <div>Headliner</div>
            <div>Venue</div>
            {!isMobile && <div>On sale</div>}
            <div>Status</div>
          </div>
          {upcoming.map((a) => {
            const date = formatDateParts(a.showDate);
            const KindIcon = KIND_ICONS[a.kind as ShowKind] ?? Music;
            const isOnSale = a.onSaleStatus === "on_sale";
            return (
              <div
                key={a.id}
                data-testid="artist-upcoming-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: gridColumns,
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
                {!isMobile && (
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
                )}
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
                      {a.productionName ?? a.headliner}
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
                      {a.productionName ?? a.headliner}
                    </div>
                  )}
                  {a.support && a.support.length > 0 && (
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10.5,
                        color: "var(--muted)",
                        marginTop: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      + {a.support.join(", ")}
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <VenueCell venue={a.venue} />
                  {isMobile && (
                    <div
                      style={{
                        fontFamily: "var(--font-geist-mono), monospace",
                        fontSize: 10,
                        color: "var(--faint)",
                        marginTop: 2,
                      }}
                    >
                      {ON_SALE_STATUS_LABELS[a.onSaleStatus] ?? a.onSaleStatus}
                    </div>
                  )}
                </div>
                {!isMobile && (
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
                )}
                {!isMobile && (
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
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function VenueCell({
  venue,
}: {
  venue: UpcomingRow["venue"];
}) {
  const location = [venue.city, venue.stateRegion].filter(Boolean).join(", ");
  const nameStyle: React.CSSProperties = {
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: 13,
    color: "var(--ink)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    textDecoration: "none",
    display: "block",
  };
  return (
    <>
      {venue.id ? (
        <Link href={`/venues/${venue.id}`} style={nameStyle}>
          {venue.name}
        </Link>
      ) : (
        <div style={nameStyle}>{venue.name}</div>
      )}
      {location && (
        <div
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10.5,
            color: "var(--muted)",
            marginTop: 2,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {location}
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 9.5,
          color: "var(--faint)",
          letterSpacing: ".12em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-geist-sans), sans-serif",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--ink)",
          letterSpacing: -0.2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function OpenInSpotifyButton({
  spotifyArtistId,
  performerName,
}: {
  spotifyArtistId: string;
  performerName: string;
}) {
  return (
    <a
      href={`https://open.spotify.com/artist/${spotifyArtistId}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${performerName} on Spotify`}
      data-testid="artist-open-in-spotify"
      style={{
        padding: "8px 14px",
        border: "1px solid var(--rule-strong)",
        background: "transparent",
        color: "var(--ink)",
        fontFamily: "var(--font-geist-sans), sans-serif",
        fontSize: 12.5,
        fontWeight: 500,
        textDecoration: "none",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <SpotifyMark size={14} />
      Open in Spotify
    </a>
  );
}

function CardMessage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "20px 16px",
        background: "var(--surface)",
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 11,
        color: "var(--muted)",
        textAlign: "center",
        letterSpacing: ".04em",
      }}
    >
      {children}
    </div>
  );
}

