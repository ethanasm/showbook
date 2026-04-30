"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { SectionHeader } from "@/components/design-system";

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

interface ScrapeConfigSectionProps {
  venueId: string;
  venueName: string;
}

export function ScrapeConfigSection({
  venueId,
  venueName,
}: ScrapeConfigSectionProps) {
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
                  Last scrape:{" "}
                  {formatRelative(lastRun.completedAt ?? lastRun.startedAt)}{" "}
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
              Paste the URL of {venueName}&apos;s upcoming-events page.
              We&apos;ll fetch the page weekly and use AI to extract upcoming
              shows.
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
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
              }}
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
