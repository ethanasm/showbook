"use client";

import { ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionHead } from "@/components/PreferencesPrimitives";

interface BackfillCardProps {
  title: string;
  description: string;
  buttonLabel: string;
  confirmText: string;
  isPending: boolean;
  errorMessage: string | null;
  resultLine: string | null;
  onRun: () => void;
}

function BackfillCard({
  title,
  description,
  buttonLabel,
  confirmText,
  isPending,
  errorMessage,
  resultLine,
  onRun,
}: BackfillCardProps) {
  function handleClick() {
    if (isPending) return;
    if (typeof window !== "undefined" && !window.confirm(confirmText)) return;
    onRun();
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardTitle}>{title}</div>
      <div style={styles.cardDescription}>{description}</div>
      <div style={styles.cardActions}>
        <button
          type="button"
          onClick={handleClick}
          disabled={isPending}
          style={isPending ? styles.runButtonDisabled : styles.runButton}
          aria-label={buttonLabel}
        >
          {isPending ? "Running…" : buttonLabel}
        </button>
        {resultLine && <span style={styles.resultLine}>{resultLine}</span>}
        {errorMessage && <span style={styles.errorLine}>{errorMessage}</span>}
      </div>
    </div>
  );
}

export default function AdminView() {
  const coordsMutation = trpc.admin.backfillVenueCoordinates.useMutation();
  const tmMutation = trpc.admin.backfillVenueTicketmaster.useMutation();

  const coordsResult = coordsMutation.data
    ? `Last run: ${coordsMutation.data.geocoded} geocoded · ${coordsMutation.data.failed} failed · ${coordsMutation.data.total} total`
    : null;
  const tmResult = tmMutation.data
    ? `Last run: ${tmMutation.data.matched} matched · ${tmMutation.data.failed} failed · ${tmMutation.data.total} total`
    : null;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLabel}>Settings</div>
        <h1 style={styles.pageTitle}>
          <ShieldCheck size={20} style={styles.titleIcon} />
          Admin
        </h1>
        <div style={styles.headerSub}>
          Operator-only tools. Each action below mutates global venue rows and
          spends operator API budget — be deliberate.
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.contentInner}>
          <SectionHead
            label="Venue maintenance"
            sub="Fill in missing data on every venue row"
          />

          <BackfillCard
            title="Backfill venue coordinates"
            description="Geocode every venue with a known city but missing lat/lng or stateRegion. Calls Google Geocoding once per row."
            buttonLabel="Run coordinate backfill"
            confirmText="Run coordinate backfill across all venues? This will call Google Geocoding for every incomplete row."
            isPending={coordsMutation.isPending}
            errorMessage={coordsMutation.error?.message ?? null}
            resultLine={coordsResult}
            onRun={() => coordsMutation.mutate()}
          />

          <BackfillCard
            title="Backfill Ticketmaster venue IDs"
            description="Look up a Ticketmaster venueId for every venue that doesn't have one. Calls the Ticketmaster Discovery API once per row."
            buttonLabel="Run Ticketmaster backfill"
            confirmText="Run Ticketmaster backfill across all venues? This will call the Ticketmaster Discovery API for every venue without an id."
            isPending={tmMutation.isPending}
            errorMessage={tmMutation.error?.message ?? null}
            resultLine={tmResult}
            onRun={() => tmMutation.mutate()}
          />
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  header: {
    padding: "16px 36px",
    borderBottom: "1px solid var(--rule)",
  },
  headerLabel: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    letterSpacing: ".1em",
    textTransform: "uppercase",
  },
  pageTitle: {
    fontFamily: "var(--font-display)",
    fontWeight: 700,
    fontSize: 26,
    color: "var(--ink)",
    letterSpacing: "-0.01em",
    lineHeight: 1.1,
    marginTop: 4,
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  titleIcon: {
    color: "var(--accent)",
  },
  headerSub: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--muted)",
    marginTop: 8,
    maxWidth: 560,
    lineHeight: 1.5,
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "28px 36px 60px",
  },
  contentInner: {
    maxWidth: 720,
  },
  card: {
    background: "var(--surface)",
    border: "1px solid var(--rule)",
    padding: "18px 20px",
    marginBottom: 20,
  },
  cardTitle: {
    fontFamily: "var(--font-geist-sans)",
    fontSize: 14,
    fontWeight: 600,
    color: "var(--ink)",
    letterSpacing: -0.15,
  },
  cardDescription: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--muted)",
    marginTop: 6,
    lineHeight: 1.5,
  },
  cardActions: {
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  runButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--accent)",
    background: "transparent",
    border: "1px solid var(--accent)",
    padding: "8px 16px",
    cursor: "pointer",
  },
  runButtonDisabled: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--faint)",
    background: "transparent",
    border: "1px solid var(--rule-strong)",
    padding: "8px 16px",
    cursor: "not-allowed",
  },
  resultLine: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--muted)",
  },
  errorLine: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "#E63946",
  },
};
