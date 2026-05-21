"use client";

import { Check, Loader2, X } from "lucide-react";
import { ExternalSourceDisclaimer } from "@/components/external-connection/ExternalSourceDisclaimer";
import type { BulkImportScanApi, BulkResult } from "./useBulkImportScan";

interface BulkImportModalProps {
  scan: BulkImportScanApi;
  isDuplicate: (ticket: { headliner: string; date: string | null }) => boolean;
  gmailScanAccepted: boolean;
}

/**
 * Bulk-import review modal shared by Gmail / Eventbrite / setlist.fm.
 *
 * Renders four stacked phases driven by `scan` state — only one shows
 * at a time because their guards are mutually exclusive:
 *   1. setlist.fm username form (no OAuth — public profile lookup).
 *   2. OAuth consent step for Gmail / Eventbrite (disclaimer +
 *      "Continue with X" button that fires `startOauthPopup`).
 *   3. Loading indicator with per-message progress bar (Gmail only —
 *      SSE progress from the LLM extraction pass).
 *   4. Checkbox-selectable review list + "Add selected (N)" footer.
 *
 * The Groq-disclosure modal (`GmailConsentModal`) is a sibling of this
 * one — when `pendingGmailToken` is set, the parent renders it on top
 * to gate the first scan behind the GDPR Art. 6 / Art. 28 disclosure.
 */
export function BulkImportModal({ scan, isDuplicate, gmailScanAccepted }: BulkImportModalProps) {
  const {
    importSource,
    closeModal,
    oauthConsentStarted,
    loading,
    results,
    selected,
    adding,
    addedCount,
    gmailAccessToken,
    eventbriteAccessToken,
    setlistfmUsername, setSetlistfmUsername,
    error,
    progress,
    startSetlistfmScan,
    startOauthPopup,
    toggleSelected,
    addSelected,
  } = scan;

  if (importSource === null) return null;

  const headerSubtitle = loading
    ? importSource === "gmail"
      ? progress?.phase === "processing"
        ? `Processing ${progress.processed} of ${progress.total} emails · ${progress.found} tickets found`
        : "Searching Gmail for ticket emails..."
      : importSource === "setlistfm"
        ? "Fetching attended setlists..."
        : "Fetching Eventbrite orders..."
    : error
      ? error
      : results.length > 0
        ? `${results.length} ticket${results.length !== 1 ? "s" : ""} found · ${selected.size} selected`
        : importSource === "gmail"
          ? gmailAccessToken
            ? "No tickets found"
            : oauthConsentStarted
              ? "Waiting for Gmail authorization..."
              : "Review what we'll store before connecting"
          : importSource === "eventbrite"
            ? eventbriteAccessToken
              ? "No tickets found"
              : oauthConsentStarted
                ? "Waiting for Eventbrite authorization..."
                : "Review what we'll store before connecting"
            : "Enter your setlist.fm username";

  return (
    <div
      onClick={closeModal}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        backdropFilter: "blur(4px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg)",
          border: "1px solid var(--rule)",
          width: "100%",
          maxWidth: 640,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Modal header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--rule)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div>
            <div style={{
              fontFamily: "var(--font-display)",
              fontSize: 17,
              fontWeight: 700,
              color: "var(--ink)",
              letterSpacing: "-0.01em",
              lineHeight: 1.1,
            }}>
              {importSource === "gmail" && "Import from Gmail"}
              {importSource === "setlistfm" && "Import from setlist.fm"}
              {importSource === "eventbrite" && "Import from Eventbrite"}
            </div>
            <div style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".04em",
              marginTop: 2,
            }}>
              {headerSubtitle}
            </div>
          </div>
          <button
            onClick={closeModal}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--muted)",
              padding: 4,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Loading indicator */}
        {loading && (
          <div style={{
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderBottom: results.length > 0 ? "1px solid var(--rule)" : "none",
          }}>
            <Loader2
              size={14}
              color="var(--muted)"
              style={{ animation: "spin 1s linear infinite" }}
            />
            <span style={{
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 11,
              color: "var(--muted)",
              letterSpacing: ".04em",
            }}>
              {importSource === "gmail"
                ? progress?.phase === "processing"
                  ? `Processing ${progress.processed} of ${progress.total} · ${progress.found} found`
                  : "Searching Gmail..."
                : importSource === "setlistfm"
                  ? "Fetching attended setlists from setlist.fm..."
                  : "Fetching past orders from Eventbrite..."}
            </span>
            {importSource === "gmail" && progress?.phase === "processing" && progress.total > 0 && (
              <div style={{
                flex: 1,
                height: 3,
                background: "var(--rule)",
                borderRadius: 2,
                overflow: "hidden",
              }}>
                <div style={{
                  width: `${Math.round((progress.processed / progress.total) * 100)}%`,
                  height: "100%",
                  background: "var(--accent)",
                  borderRadius: 2,
                  transition: "width 0.3s ease",
                }} />
              </div>
            )}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* setlist.fm: username form (no OAuth, just public username lookup). */}
        {importSource === "setlistfm" && !loading && results.length === 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = setlistfmUsername.trim();
              if (!trimmed) return;
              startSetlistfmScan(trimmed);
            }}
            style={{
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              borderBottom: "1px solid var(--rule)",
            }}
          >
            <label
              style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--muted)",
                letterSpacing: ".06em",
                textTransform: "uppercase",
              }}
            >
              Your setlist.fm username
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={setlistfmUsername}
                onChange={(e) => setSetlistfmUsername(e.target.value)}
                placeholder="e.g. yourname"
                autoFocus
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  border: "1px solid var(--rule-strong)",
                  background: "transparent",
                  color: "var(--ink)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 13,
                }}
              />
              <button
                type="submit"
                disabled={!setlistfmUsername.trim()}
                style={{
                  padding: "8px 16px",
                  border: "none",
                  background: setlistfmUsername.trim() ? "var(--ink)" : "var(--rule)",
                  color: setlistfmUsername.trim() ? "var(--bg)" : "var(--muted)",
                  fontFamily: "var(--font-geist-sans), sans-serif",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: setlistfmUsername.trim() ? "pointer" : "default",
                  letterSpacing: -0.1,
                }}
              >
                Fetch
              </button>
            </div>
            <ExternalSourceDisclaimer source="setlistfm" />
          </form>
        )}

        {/* gmail / eventbrite: consent step. Renders before the
            OAuth popup opens so the user sees what we store and
            why first. "Continue with X" opens the popup. */}
        {(importSource === "gmail" || importSource === "eventbrite")
          && !oauthConsentStarted
          && !loading
          && results.length === 0
          && (importSource === "gmail" ? !gmailAccessToken : !eventbriteAccessToken)
          && (
          <div
            style={{
              padding: "20px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              borderBottom: "1px solid var(--rule)",
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--ink)",
              }}
            >
              {importSource === "gmail"
                ? "Showbook will scan your inbox for ticket emails and surface them here so you can pick which shows to import."
                : "Showbook will fetch your past Eventbrite orders so you can pick which shows to import."}
            </div>
            <ExternalSourceDisclaimer source={importSource} />
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => startOauthPopup(importSource, gmailScanAccepted)}
                data-testid={`${importSource}-consent-continue`}
                style={{
                  padding: "10px 16px",
                  border: "none",
                  background: "var(--ink)",
                  color: "var(--bg)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                {importSource === "gmail"
                  ? "Continue with Gmail →"
                  : "Continue with Eventbrite →"}
              </button>
              <button
                type="button"
                onClick={closeModal}
                style={{
                  padding: "10px 12px",
                  border: "none",
                  background: "transparent",
                  color: "var(--muted)",
                  fontFamily: "var(--font-geist-mono), monospace",
                  fontSize: 11,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
              >
                Not now
              </button>
            </div>
          </div>
        )}

        {/* Results list */}
        {results.length > 0 && (
          <div style={{
            flex: 1,
            overflowY: "auto",
            minHeight: 0,
          }}>
            {results.map((ticket: BulkResult, i: number) => {
              const dup = isDuplicate(ticket);
              const isSelected = selected.has(i);
              return (
                <div
                  key={`${ticket.gmailMessageId}-${i}`}
                  onClick={() => toggleSelected(i)}
                  style={{
                    padding: "12px 20px",
                    borderTop: i > 0 ? "1px solid var(--rule)" : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                    opacity: dup ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--surface)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {/* Checkbox */}
                  <div style={{
                    width: 18,
                    height: 18,
                    border: `1px solid ${isSelected ? "var(--ink)" : "var(--rule-strong)"}`,
                    background: isSelected ? "var(--ink)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {isSelected && <Check size={12} color="var(--bg)" />}
                  </div>

                  {/* Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}>
                      <span style={{
                        fontFamily: "var(--font-geist-sans), sans-serif",
                        fontSize: 13,
                        fontWeight: 500,
                        color: "var(--ink)",
                        letterSpacing: -0.1,
                      }}>
                        {ticket.production_name ?? ticket.headliner}
                      </span>
                      {dup && (
                        <span style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 9,
                          color: "var(--muted)",
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                          padding: "1px 5px",
                          border: "1px solid var(--rule-strong)",
                        }}>
                          Already added
                        </span>
                      )}
                      {ticket.kind_hint && (
                        <span style={{
                          fontFamily: "var(--font-geist-mono), monospace",
                          fontSize: 9,
                          color: "var(--faint)",
                          letterSpacing: ".06em",
                          textTransform: "uppercase",
                        }}>
                          {ticket.kind_hint}
                        </span>
                      )}
                    </div>
                    <div style={{
                      fontFamily: "var(--font-geist-mono), monospace",
                      fontSize: 10.5,
                      color: "var(--muted)",
                      letterSpacing: ".04em",
                      marginTop: 2,
                      display: "flex",
                      gap: 12,
                    }}>
                      {ticket.venue_name && <span>{ticket.venue_name}</span>}
                      {ticket.venue_city && <span>{ticket.venue_city}</span>}
                      {ticket.date && <span>{ticket.date}</span>}
                      {ticket.seat && <span>{ticket.seat}</span>}
                      {ticket.price && <span>${ticket.price}{ticket.ticket_count && ticket.ticket_count > 1 ? ` (${ticket.ticket_count} tix)` : ""}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        {results.length > 0 && (
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--rule)",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 10,
          }}>
            {addedCount > 0 && !adding && (
              <span style={{
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 11,
                color: "var(--kind-concert)",
                letterSpacing: ".04em",
              }}>
                {addedCount} added
              </span>
            )}
            <button
              onClick={addSelected}
              disabled={selected.size === 0 || adding}
              style={{
                padding: "8px 16px",
                border: "none",
                background: selected.size > 0 && !adding ? "var(--ink)" : "var(--rule)",
                color: selected.size > 0 && !adding ? "var(--bg)" : "var(--muted)",
                fontFamily: "var(--font-geist-sans), sans-serif",
                fontSize: 13,
                fontWeight: 600,
                cursor: selected.size > 0 && !adding ? "pointer" : "default",
                letterSpacing: -0.1,
              }}
            >
              {adding
                ? `Adding... ${addedCount}/${selected.size}`
                : `Add selected (${selected.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface GmailConsentModalProps {
  submitting: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

/**
 * One-time consent modal for the Gmail → Groq scan flow. Mirrors the
 * `DeleteAccountModal` pattern in `apps/web/app/(app)/preferences/View.client.tsx`:
 * hand-rolled fixed-position overlay, `role="dialog"`, click-outside
 * to dismiss.
 */
export function GmailConsentModal({
  submitting,
  onAccept,
  onCancel,
}: GmailConsentModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gmail-consent-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        display: "grid",
        placeItems: "center",
        background: "rgba(0, 0, 0, 0.6)",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: 12,
          padding: 24,
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <h2
            id="gmail-consent-title"
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 20,
              fontWeight: 700,
              color: "var(--ink)",
            }}
          >
            Before we scan your email
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--muted)",
            }}
          >
            Showbook will send the matched email subject + body (first
            8&nbsp;KB) to <strong style={{ color: "var(--ink)" }}>Groq</strong>, a
            third-party AI provider, to extract ticket details. We
            don&apos;t store the raw email content — only the
            structured result. By accepting, you consent to this
            processing under our{" "}
            <a
              href="/privacy"
              target="_blank"
              rel="noreferrer"
              style={{
                color: "var(--accent)",
                textDecoration: "underline",
              }}
            >
              privacy policy
            </a>
            . You can change your mind anytime by disconnecting Gmail
            and not running another scan.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 4,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              fontWeight: 500,
              color: "var(--ink)",
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              borderRadius: 0,
              padding: "6px 12px",
              cursor: submitting ? "not-allowed" : "pointer",
              letterSpacing: ".06em",
              textTransform: "uppercase",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={submitting}
            style={{
              fontFamily: "var(--font-geist-mono)",
              fontSize: 10.5,
              fontWeight: 600,
              color: "var(--accent-text)",
              background: "var(--accent)",
              border: "1px solid var(--accent)",
              borderRadius: 0,
              padding: "6px 12px",
              cursor: submitting ? "not-allowed" : "pointer",
              letterSpacing: ".06em",
              textTransform: "uppercase",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Saving…" : "Accept and scan"}
          </button>
        </div>
      </div>
    </div>
  );
}

