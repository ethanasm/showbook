"use client";

import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { HeroCard } from "@/components/design-system/HeroCard";
import { ShowRow } from "@/components/design-system/ShowRow";

function getHeadliner(
  showPerformers: {
    role: string;
    sortOrder: number;
    performer: { name: string };
  }[]
): string {
  const headliner = showPerformers.find(
    (sp) => sp.role === "headliner" && sp.sortOrder === 1
  );
  if (headliner) return headliner.performer.name;
  return showPerformers[0]?.performer.name ?? "Unknown Artist";
}

function getSupport(
  showPerformers: {
    role: string;
    sortOrder: number;
    performer: { name: string };
  }[]
): string[] {
  return showPerformers
    .filter((sp) => sp.role === "support")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((sp) => sp.performer.name);
}

function toDateParts(dateStr: string): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date(dateStr);
  return {
    month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    dow: d.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

function countdownText(dateStr: string): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const days = Math.ceil(
    (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (days < 0) return `${Math.abs(days)} days ago`;
  if (days === 0) return "tonight";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

export default function HomePage() {
  const { data: shows, isLoading } = trpc.shows.list.useQuery({});

  const heroShow = useMemo(() => {
    if (!shows) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    const ticketed = shows
      .filter((s) => s.state === "ticketed" && new Date(s.date) >= now)
      .sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

    return ticketed[0] ?? null;
  }, [shows]);

  const recentShows = useMemo(() => {
    if (!shows) return [];
    return shows
      .filter((s) => s.state === "past")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5);
  }, [shows]);

  if (isLoading) {
    return (
      <div style={styles.container}>
        <p style={styles.loading}>Loading...</p>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Hero Section */}
      <section style={styles.section}>
        {heroShow ? (
          <HeroCard
            show={{
              headliner: getHeadliner(heroShow.showPerformers),
              support: getSupport(heroShow.showPerformers),
              venue: heroShow.venue.name,
              city: [heroShow.venue.city, heroShow.venue.stateRegion]
                .filter(Boolean)
                .join(", "),
              seat: heroShow.seat ?? "",
              paid: heroShow.pricePaid
                ? parseFloat(heroShow.pricePaid)
                : 0,
              kind: heroShow.kind,
              date: toDateParts(heroShow.date),
              countdown: countdownText(heroShow.date),
              hasTix: heroShow.state === "ticketed",
            }}
          />
        ) : (
          <div style={styles.emptyHero}>
            <p style={styles.emptyHeroText}>
              No upcoming shows — add one!
            </p>
          </div>
        )}
      </section>

      {/* Recent Shows Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Recent</h2>
        {recentShows.length > 0 ? (
          <div style={styles.showList}>
            {recentShows.map((show) => (
              <ShowRow
                key={show.id}
                show={{
                  kind: show.kind,
                  state: show.state,
                  headliner: getHeadliner(show.showPerformers),
                  support: show.showPerformers
                    .filter((sp) => sp.role === "support")
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((sp) => sp.performer.name),
                  venue: show.venue.name,
                  neighborhood: [show.venue.city, show.venue.stateRegion]
                    .filter(Boolean)
                    .join(", ") || undefined,
                  date: toDateParts(show.date),
                  seat: show.seat ?? undefined,
                  paid: show.pricePaid
                    ? parseFloat(show.pricePaid)
                    : undefined,
                }}
              />
            ))}
          </div>
        ) : (
          <p style={styles.emptyText}>No past shows yet</p>
        )}
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 800,
    margin: "0 auto",
    padding: "24px 16px",
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: 12,
  },
  showList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  loading: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-sans)",
    textAlign: "center",
    padding: "48px 0",
  },
  emptyHero: {
    background: "var(--surface)",
    border: "1px dashed var(--border)",
    borderRadius: 16,
    padding: "48px 24px",
    textAlign: "center",
  },
  emptyHeroText: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-sans)",
    fontSize: 16,
  },
  emptyText: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-geist-sans)",
    fontSize: 14,
  },
};
