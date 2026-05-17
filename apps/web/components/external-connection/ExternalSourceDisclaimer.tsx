"use client";

import { Database, Sparkles, Shield } from "lucide-react";

export type ExternalSource = "spotify" | "setlistfm" | "gmail" | "eventbrite";

interface SourceCopy {
  store: string;
  use: string;
  revoke: string;
}

const COPY: Record<ExternalSource, SourceCopy> = {
  spotify: {
    store:
      "Your Spotify display name and an access token (we refresh it for you), plus the artists you've dismissed in import.",
    use: "Builds Hype and Heard playlists, identifies songs, and surfaces show stats. We never post on your behalf.",
    revoke:
      "Disconnect anytime in Preferences — tokens are deleted within 30 days.",
  },
  setlistfm: {
    store:
      "Your setlist.fm username (no password, no token — it's the only credential setlist.fm uses).",
    use: "Pulls every concert you've marked attended on setlist.fm, including the setlist itself.",
    revoke: "Change or clear it anytime in Preferences.",
  },
  gmail: {
    store:
      "Nothing from your inbox. We read tickets in real time and only persist the shows you tick to import.",
    use: "Finds ticket confirmations from Ticketmaster, AXS, See Tickets, and Eventbrite to pre-fill your logbook.",
    revoke: "Read-only access. Revoke anytime from your Google account.",
  },
  eventbrite: {
    store:
      "An access token to fetch your past Eventbrite orders. No order content is kept beyond the shows you save.",
    use: "Backfills past Eventbrite orders into your logbook.",
    revoke: "Revoke anytime from your Eventbrite account.",
  },
};

export function ExternalSourceDisclaimer({
  source,
}: {
  source: ExternalSource;
}) {
  const copy = COPY[source];
  return (
    <div style={containerStyle} data-testid={`disclaimer-${source}`}>
      <div style={eyebrowStyle}>What we store</div>
      <Row icon={<Database size={12} aria-hidden />}>{copy.store}</Row>
      <Row icon={<Sparkles size={12} aria-hidden />}>{copy.use}</Row>
      <Row icon={<Shield size={12} aria-hidden />}>{copy.revoke}</Row>
    </div>
  );
}

function Row({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={rowStyle}>
      <span style={iconCellStyle}>{icon}</span>
      <span style={textStyle}>{children}</span>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  paddingTop: 12,
  paddingBottom: 4,
  marginTop: 4,
  borderTop: "1px solid var(--rule)",
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-geist-mono), monospace",
  fontSize: 10.5,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--muted)",
  marginBottom: 2,
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
};

const iconCellStyle: React.CSSProperties = {
  flex: "0 0 16px",
  marginTop: 3,
  color: "var(--muted)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const textStyle: React.CSSProperties = {
  fontFamily: "var(--font-geist-sans), sans-serif",
  fontSize: 12.5,
  lineHeight: 1.5,
  color: "var(--ink)",
};
