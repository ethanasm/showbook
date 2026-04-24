"use client";

import { useState } from "react";
import {
  ThemeProvider,
  useTheme,
  KindBadge,
  StateChip,
  ShowRow,
  HeroCard,
  SegmentedControl,
  Sidebar,
} from "@/components/design-system";

function futureDate(daysFromNow: number): {
  month: string;
  day: string;
  year: string;
  dow: string;
} {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return {
    month: d.toLocaleDateString("en-US", { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
    year: String(d.getFullYear()),
    dow: d.toLocaleDateString("en-US", { weekday: "short" }),
  };
}

function DevContent() {
  const { theme, setTheme, resolved } = useTheme();
  const [segment, setSegment] = useState("Upcoming");
  const [sidebarActive, setSidebarActive] = useState("home");

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text-primary)",
      }}
    >
      {/* Sidebar */}
      <Sidebar active={sidebarActive} onNavigate={setSidebarActive} />

      {/* Main content */}
      <main style={{ flex: 1, padding: 40, maxWidth: 800 }}>
        <h1
          style={{
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: "1.8rem",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            marginBottom: 8,
          }}
        >
          Design System Preview
        </h1>
        <p
          style={{
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: "0.8rem",
            color: "var(--text-secondary)",
            marginBottom: 32,
          }}
        >
          Theme: {theme} (resolved: {resolved})
        </p>

        {/* Theme Toggle */}
        <Section title="Theme Toggle">
          <div style={{ display: "flex", gap: 8 }}>
            {(["dark", "light", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                style={{
                  padding: "6px 16px",
                  borderRadius: 999,
                  border:
                    theme === t
                      ? "1px solid var(--marquee-gold)"
                      : "1px solid var(--border)",
                  background:
                    theme === t ? "var(--marquee-gold)" : "transparent",
                  color: theme === t ? "#0C0C0C" : "var(--text-secondary)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: "0.75rem",
                  cursor: "pointer",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </Section>

        {/* KindBadge */}
        <Section title="KindBadge">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <KindBadge kind="concert" />
            <KindBadge kind="theatre" />
            <KindBadge kind="comedy" />
            <KindBadge kind="festival" />
          </div>
        </Section>

        {/* StateChip */}
        <Section title="StateChip">
          <div style={{ display: "flex", gap: 8 }}>
            <StateChip state="ticketed" />
            <StateChip state="watching" />
          </div>
        </Section>

        {/* SegmentedControl */}
        <Section title="SegmentedControl">
          <SegmentedControl
            options={["Upcoming", "Past", "Watching"]}
            selected={segment}
            onChange={setSegment}
          />
        </Section>

        {/* ShowRow */}
        <Section title="ShowRow">
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              background: "var(--surface)",
              borderRadius: 12,
              padding: 8,
              border: "1px solid var(--border)",
            }}
          >
            <ShowRow
              show={{
                kind: "concert",
                state: "past",
                headliner: "Radiohead",
                support: ["Caribou"],
                venue: "Madison Square Garden",
                neighborhood: "Midtown",
                date: { month: "NOV", day: "15", year: "2025", dow: "Sat" },
                paid: 185,
              }}
            />
            <ShowRow
              show={{
                kind: "theatre",
                state: "ticketed",
                headliner: "Hamilton",
                venue: "Richard Rodgers Theatre",
                neighborhood: "Times Square",
                date: futureDate(12),
                seat: "Orch C-114",
                paid: 250,
              }}
            />
            <ShowRow
              show={{
                kind: "comedy",
                state: "watching",
                headliner: "John Mulaney",
                venue: "Beacon Theatre",
                neighborhood: "Upper West Side",
                date: futureDate(30),
              }}
            />
          </div>
        </Section>

        {/* HeroCard */}
        <Section title="HeroCard">
          <HeroCard
            show={{
              headliner: "Hamilton",
              support: ["Leslie Odom Jr.", "Daveed Diggs"],
              venue: "Richard Rodgers Theatre",
              city: "New York, NY",
              seat: "ORCH C-114",
              paid: 250,
              kind: "theatre",
              date: futureDate(12),
              countdown: "in 12 days",
              hasTix: true,
            }}
          />
        </Section>
      </main>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 32 }}>
      <h2
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: "0.7rem",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--text-secondary)",
          marginBottom: 12,
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DevComponentsPage() {
  return (
    <ThemeProvider>
      <DevContent />
    </ThemeProvider>
  );
}
