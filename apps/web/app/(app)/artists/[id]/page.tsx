"use client";

import { useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import {
  Music,
  Plus,
  Check,
  ChevronLeft,
} from "lucide-react";
import {
  ShowRow as ShowRowComponent,
  type ShowKind,
  type ShowState,
} from "@/components/design-system";
import { EditableName } from "@/components/EditableName";

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
  date: string;
  endDate: string | null;
  seat: string | null;
  pricePaid: string | null;
  ticketCount: number;
  tourName: string | null;
  productionName: string | null;
  venue: Venue;
  showPerformers: ShowPerformer[];
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

function getSupport(show: ShowData): string[] {
  return show.showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);
}

export default function ArtistDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const performerId = params?.id ?? "";

  const utils = trpc.useUtils();

  const detailQuery = trpc.performers.detail.useQuery(
    { performerId },
    { enabled: Boolean(performerId) },
  );

  const userShowsQuery = trpc.performers.userShows.useQuery(
    { performerId },
    { enabled: Boolean(performerId) },
  );

  const followMutation = trpc.performers.follow.useMutation({
    onSuccess: () => {
      utils.performers.detail.invalidate({ performerId });
    },
  });

  const unfollowMutation = trpc.performers.unfollow.useMutation({
    onSuccess: () => {
      utils.performers.detail.invalidate({ performerId });
    },
  });

  const renameMutation = trpc.performers.rename.useMutation({
    onSuccess: () => {
      utils.performers.detail.invalidate();
      utils.performers.list.invalidate();
    },
  });

  const performer = detailQuery.data;
  const userShows = useMemo(
    () => (userShowsQuery.data ?? []) as ShowData[],
    [userShowsQuery.data],
  );

  const stats = useMemo(() => {
    const sorted = [...userShows].sort((a, b) => a.date.localeCompare(b.date));
    return {
      first: sorted[0]?.date ?? null,
      last: sorted[sorted.length - 1]?.date ?? null,
    };
  }, [userShows]);

  const followBusy =
    followMutation.isPending || unfollowMutation.isPending;

  function toggleFollow() {
    if (!performer || followBusy) return;
    if (performer.isFollowed) {
      unfollowMutation.mutate({ performerId: performer.id });
    } else {
      followMutation.mutate({ performerId: performer.id });
    }
  }

  if (detailQuery.isLoading) {
    return <CenteredMessage>Loading artist…</CenteredMessage>;
  }

  if (detailQuery.error || !performer) {
    return (
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
    );
  }

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
          padding: "28px 36px 24px",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "1fr auto",
          columnGap: 32,
          alignItems: "end",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".1em",
              textTransform: "uppercase",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            <Music size={12} /> Artist
          </div>
          <EditableName
            value={performer.name}
            onSave={(name) =>
              renameMutation.mutate({ performerId: performer.id, name })
            }
          />
        </div>

        {/* Follow button */}
        <button
          type="button"
          onClick={toggleFollow}
          disabled={followBusy}
          style={{
            padding: "8px 14px",
            border: `1px solid ${
              performer.isFollowed ? "var(--accent)" : "var(--rule-strong)"
            }`,
            background: performer.isFollowed ? "var(--accent)" : "transparent",
            color: performer.isFollowed ? "var(--bg)" : "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12.5,
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: followBusy ? "default" : "pointer",
            opacity: followBusy ? 0.6 : 1,
          }}
        >
          {performer.isFollowed ? (
            <>
              <Check size={13} /> Following
            </>
          ) : (
            <>
              <Plus size={13} /> Follow
            </>
          )}
        </button>
      </div>

      {/* Stat strip */}
      <div
        style={{
          padding: "16px 36px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--rule)",
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          columnGap: 28,
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
          padding: "24px 36px 48px",
          display: "flex",
          flexDirection: "column",
          gap: 36,
        }}
      >
        <section>
          <SectionHeader
            label={`Your shows · ${userShows.length}`}
            note="newest first"
          />
          {userShowsQuery.isLoading ? (
            <CardMessage>Loading your history…</CardMessage>
          ) : userShows.length === 0 ? (
            <CardMessage>You haven&apos;t logged any shows with this artist yet.</CardMessage>
          ) : (
            <div style={{ background: "var(--surface)" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "14px 80px 110px 1.2fr 1fr 110px 64px 88px",
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
                <div>Date</div>
                <div>Kind</div>
                <div>Headline</div>
                <div>Venue</div>
                <div>Seat</div>
                <div style={{ textAlign: "right" }}>Paid</div>
                <div style={{ textAlign: "right" }}>State</div>
              </div>
              {userShows.map((s) => (
                <ShowRowComponent
                  key={s.id}
                  show={{
                    kind: s.kind,
                    state: s.state,
                    headliner: getHeadliner(s),
                    support: getSupport(s),
                    venue: s.venue.name,
                    venueId: s.venue.id,
                    showId: s.id,
                    date: formatDateParts(s.date),
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
        fontSize: 11,
        color: tone === "error" ? "var(--kind-theatre)" : "var(--muted)",
      }}
    >
      {children}
    </div>
  );
}
