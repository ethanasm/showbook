"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { ChevronLeft } from "lucide-react";
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
import { formatDateMedium as formatDateLong, formatDateParts } from "@showbook/shared";
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

  // Phase 2 — Songs section. The list is bounded server-side; only
  // request the top 25 frequencies. Hide the section when there are
  // no rows so artists with no setlist data don't render an empty
  // chrome.
  const songsQuery = trpc.songs.list.useQuery(
    {
      performerId,
      firstHeardOnly: false,
      tourDebutOnly: false,
      limit: 25,
    },
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
          gridTemplateColumns: "repeat(3, 1fr)",
          columnGap: isMobile ? 12 : 28,
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

function SpotifyMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 168 168"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <circle fill="#1DB954" cx="84" cy="84" r="84" />
      <path
        fill="#fff"
        d="M119.27 119.7c-1.6 2.62-5.04 3.45-7.66 1.84-21-12.84-47.43-15.74-78.57-8.62-2.99.68-5.97-1.19-6.66-4.18-.68-2.99 1.19-5.97 4.18-6.66 34.04-7.78 63.27-4.42 86.86 9.97 2.62 1.6 3.45 5.04 1.85 7.66zm9.92-22.06c-2.01 3.27-6.29 4.3-9.55 2.29-24.04-14.78-60.7-19.06-89.13-10.43-3.67 1.11-7.55-.96-8.66-4.62-1.11-3.67.96-7.54 4.62-8.66 32.49-9.86 72.89-5.08 100.5 11.87 3.27 2.01 4.3 6.29 2.29 9.56zm.85-22.97c-28.83-17.12-76.39-18.7-103.93-10.34-4.4 1.34-9.05-1.15-10.39-5.55-1.34-4.4 1.15-9.05 5.55-10.39 31.6-9.59 84.04-7.74 117.21 11.95 3.96 2.35 5.26 7.46 2.91 11.42-2.35 3.96-7.46 5.26-11.42 2.91z"
      />
    </svg>
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

