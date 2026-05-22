"use client";

import { setlistTotalSongs } from "@showbook/shared";
import { type ShowKind } from "@/components/design-system";
import { LivePreview } from "./LivePreview";
import { PerformerSetlistBlock } from "@/components/PerformerSetlistBlock";
import { FestivalLineupModal } from "@/components/add/FestivalLineupModal";
import { AddShowChat } from "@/components/add/AddShowChat";
import { AddShowGmail, useAddShowGmail } from "@/components/add/AddShowGmail";
import { MediaUploadSection } from "@/components/add/MediaUploadSection";
import { useAddShowForm } from "./useAddShowForm";
import { IMPORT_SOURCES, KIND_CONFIG, TIMEFRAME_CONFIG, mono, sans } from "./constants";

// ── Main Component ───────────────────────────────────────────

export default function AddPage() {
  const form = useAddShowForm();
  const {
    router,
    mode, setMode,
    isEditMode,
    editQuery,
    timeframe, setTimeframe, timeframeManuallySet,
    kind, setKind,
    headlinerName,
    headliner, setHeadliner,
    venue,
    venueQuery,
    debouncedVenueQuery,
    date,
    endDate, setEndDate,
    tmEnriched, selectedTmEvent,
    importUrlOpen, setImportUrlOpen,
    importUrlValue, setImportUrlValue,
    pdfImporting, pdfError, pdfInputRef,
    setlistsByPerformer, setSetlistsByPerformer,
    tourName, setTourName,
    performers, setPerformers,
    castMembers,
    openerName, setOpenerName,
    productionName, setProductionName,
    notes, setNotes,
    seat, setSeat,
    pricePaid, setPricePaid,
    ticketCount, setTicketCount,
    showMoreDetails, setShowMoreDetails,
    performerSearchInput,
    debouncedPerformerQuery,
    debouncedQuery,
    utils,
    tmSearch, festivalHeadlinerSearch, performerArtistSearch,
    fetchTMEvent,
    venueSearch,
    setlistQuery,
    createShow, updateShow,
    extractCast,
    parseChat,
    scanGmailForShow,
    isPastConcert, isPastEvent,
    fetchingSetlistFor, setFetchingSetlistFor,
    hasIdentity, canSave,
    autoFilledCount, provenanceStatuses,
    festivalFlow,
    festivalModalOpen, setFestivalModalOpen,
    festivalFileInputRef,
    openFestivalPicker,
    handleFestivalFileChange,
    media,
    handleHeadlinerInput, handleDateChange,
    handleSelectTmResult,
    handleChatTmEventSelected, searchTMEvents,
    handleImportFromUrl, handlePdfImport,
    handlePlaybillUpload,
    handleSelectGmailResult,
    handleFormSave,
    handleVenueInput, handleSelectPlace,
    handlePerformerSearchInput,
    handleAddPerformer,
    handleSelectArtistAsPerformer,
    handleSelectArtistAsHeadliner,
    handleRemovePerformer,
    handleTogglePerformerRole,
    clearHeadlinerSearch,
    useManualHeadliner,
  } = form;

  const gmail = useAddShowGmail({
    scanGmailForShow,
    getHeadlinerName: () => headlinerName,
    getVenueName: () => venue.name,
  });

  // Kind color helper
  const kindColor = (k: ShowKind) => `var(--kind-${k})`;

  // ── Render: Form Mode (Left Panel) ─────────────────────────

  const renderFormPanel = () => (
    <div style={{
      padding: "28px 36px 100px",
      overflow: "auto",
      minHeight: 0,
      flex: 1,
    }}>
      {/* Heading + mode tabs */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 20, marginBottom: 20 }}>
        <div>
          <div style={{
            fontFamily: mono,
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".08em",
            textTransform: "uppercase",
          }}>
            {isEditMode ? "Editing record" : "New record · draft"}
          </div>
          <div style={{
            fontFamily: sans,
            fontSize: 32,
            fontWeight: 600,
            color: "var(--ink)",
            letterSpacing: -1,
            marginTop: 4,
          }}>
            {isEditMode ? "Edit show" : "Add a show"}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Mode Tabs — hidden in edit mode */}
        {!isEditMode && (
          <div style={{ display: "inline-flex", border: `1px solid var(--rule-strong)` }}>
            {(["Form", "Chat"] as const).map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                style={{
                  padding: "7px 14px",
                  background: mode === m ? "var(--ink)" : "transparent",
                  color: mode === m ? "var(--bg)" : "var(--muted)",
                  fontFamily: mono,
                  fontSize: 11,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  fontWeight: 500,
                  border: "none",
                  borderLeft: i === 0 ? "none" : `1px solid var(--rule-strong)`,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {m === "Form" ? "FORM" : "CONVERSATIONAL"}
              </button>
            ))}
          </div>
        )}
      </div>

      {mode === "Chat" ? (
        <AddShowChat
          parseChat={parseChat}
          createShow={createShow}
          festivalFlowPhase={festivalFlow.phase}
          onFestivalFile={openFestivalPicker}
          searchTMEvents={searchTMEvents}
          onTmEventSelected={handleChatTmEventSelected}
        />
      ) : (
        renderFormFields()
      )}
    </div>
  );

  const renderFormFields = () => (
    <>
      {/* ── Import From (top of form, add mode only) ── */}
      {!isEditMode && (
        <div style={{ marginBottom: 0 }}>
          <FieldLabel hint="start from a source">Import from</FieldLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
            {IMPORT_SOURCES.map((src) => (
              <div
                key={src.tag}
                onClick={
                  src.tag === "mail" ? gmail.start
                  : src.tag === "url" ? () => setImportUrlOpen((v) => !v)
                  : src.tag === "pdf" ? () => pdfInputRef.current?.click()
                  : undefined
                }
                style={{
                  padding: "12px 14px",
                  background: src.tag === "mail" && gmail.scanning ? "var(--ink)"
                    : src.tag === "url" && importUrlOpen ? "var(--ink)"
                    : src.tag === "pdf" && pdfImporting ? "var(--ink)"
                    : "var(--surface)",
                  border: `1px solid var(--rule-strong)`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    fontFamily: mono,
                    fontSize: 9.5,
                    color: (src.tag === "mail" && gmail.scanning) || (src.tag === "url" && importUrlOpen) || (src.tag === "pdf" && pdfImporting) ? "var(--bg)" : "var(--muted)",
                    letterSpacing: ".1em",
                    padding: "2px 5px",
                    border: `1px solid ${(src.tag === "mail" && gmail.scanning) || (src.tag === "url" && importUrlOpen) || (src.tag === "pdf" && pdfImporting) ? "var(--bg)" : "var(--rule-strong)"}`,
                    textTransform: "uppercase",
                  }}>
                    {src.tag}
                  </div>
                  <div style={{
                    fontFamily: sans,
                    fontSize: 13,
                    fontWeight: 500,
                    color: (src.tag === "mail" && gmail.scanning) || (src.tag === "url" && importUrlOpen) || (src.tag === "pdf" && pdfImporting) ? "var(--bg)" : "var(--ink)",
                    letterSpacing: -0.1,
                  }}>
                    {src.tag === "mail" && gmail.scanning ? "Scanning..." : src.tag === "url" && fetchTMEvent.isPending ? "Importing..." : src.tag === "pdf" && pdfImporting ? "Extracting..." : src.label}
                  </div>
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: (src.tag === "mail" && gmail.scanning) || (src.tag === "url" && importUrlOpen) || (src.tag === "pdf" && pdfImporting) ? "var(--bg)" : "var(--faint)",
                  letterSpacing: ".04em",
                }}>
                  {src.sub}
                </div>
              </div>
            ))}
          </div>

          {/* Hidden PDF file input */}
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            onChange={handlePdfImport}
            style={{ display: "none" }}
          />
          {pdfError && (
            <div style={{ fontFamily: mono, fontSize: 10.5, color: "#E63946", marginTop: 6 }}>
              {pdfError}
            </div>
          )}

          {/* URL import input */}
          {importUrlOpen && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                padding: "10px 14px",
                background: "var(--surface)",
                border: "1px solid var(--rule-strong)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <input
                  type="text"
                  placeholder="https://www.ticketmaster.com/.../event/..."
                  value={importUrlValue}
                  onChange={(e) => setImportUrlValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); handleImportFromUrl(); }
                    if (e.key === "Escape") { setImportUrlOpen(false); setImportUrlValue(""); }
                  }}
                  autoFocus
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontFamily: mono,
                    fontSize: 13,
                    color: "var(--ink)",
                    letterSpacing: -0.1,
                  }}
                />
                <button
                  type="button"
                  onClick={handleImportFromUrl}
                  disabled={fetchTMEvent.isPending || !importUrlValue.trim()}
                  style={{
                    padding: "6px 12px",
                    background: importUrlValue.trim() ? "var(--ink)" : "var(--surface2)",
                    color: importUrlValue.trim() ? "var(--bg)" : "var(--faint)",
                    fontFamily: mono,
                    fontSize: 10.5,
                    letterSpacing: ".06em",
                    textTransform: "uppercase" as const,
                    border: "none",
                    cursor: importUrlValue.trim() ? "pointer" : "not-allowed",
                  }}
                >
                  {fetchTMEvent.isPending ? "Loading..." : "Import"}
                </button>
              </div>
              {fetchTMEvent.isError && (
                <div style={{ fontFamily: mono, fontSize: 10.5, color: "#E63946", marginTop: 6 }}>
                  {fetchTMEvent.error?.message?.includes("not found")
                    ? "Event not found. Check the URL and try again."
                    : "Failed to import. Check the URL and try again."}
                </div>
              )}
            </div>
          )}

          {/* Gmail results dropdown */}
          <AddShowGmail
            gmail={gmail}
            headlinerName={headlinerName}
            onSelect={handleSelectGmailResult}
          />

          {/* Separator below import section */}
          <div style={{ borderBottom: "1px solid var(--rule)", margin: "22px 0 26px" }} />
        </div>
      )}

      {/* ── WHAT ── */}
      <SectionLabel>What</SectionLabel>

      {/* ── Kind ── */}
      <div style={{ marginBottom: 26 }}>
        <FieldLabel hint="drives which data source is used">Kind</FieldLabel>
        <div
          style={{
            // Auto-fit grid so the row collapses to 2x2 on phone widths
            // (~390px) and runs all four across at desktop widths.
            // `display: flex` with `flex: 1` here used to overflow on
            // mobile because flex items default to `min-width: auto`
            // and won't shrink below their intrinsic text content.
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            borderLeft: `1px solid var(--rule-strong)`,
          }}
        >
          {KIND_CONFIG.map((k) => {
            const active = kind === k.kind;
            const c = kindColor(k.kind);
            return (
              <button
                key={k.kind}
                type="button"
                onClick={() => setKind(k.kind)}
                style={{
                  padding: "14px 14px",
                  background: active ? "var(--surface)" : "transparent",
                  borderLeft: active ? `2px solid ${c}` : "2px solid transparent",
                  borderTop: `1px solid var(--rule-strong)`,
                  borderRight: `1px solid var(--rule-strong)`,
                  borderBottom: `1px solid var(--rule-strong)`,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 0,
                }}
              >
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: mono,
                  fontSize: 10.5,
                  color: c,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  fontWeight: 500,
                }}>
                  <span style={{ fontSize: 14 }}>{k.icon}</span>
                  {k.label}
                </div>
                <div style={{
                  fontFamily: mono,
                  fontSize: 10,
                  color: active ? "var(--muted)" : "var(--faint)",
                  letterSpacing: ".02em",
                }}>
                  {k.enrichmentHint}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Festival Name / Show Title (WHAT section) ── */}
      {(kind === "festival" || kind === "theatre") && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel>{kind === "festival" ? "Festival Name" : "Show Title"}</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>{kind === "festival" ? "★" : "🎭"}</span>
            <input
              type="text"
              placeholder={kind === "festival" ? "e.g. Governors Ball, Coachella" : "e.g. Wicked, Hamilton"}
              value={productionName}
              onChange={(e) => setProductionName(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: productionName ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.1,
                width: "100%",
              }}
            />
          </div>
        </div>
      )}

      {/* ── Festival: upload poster / schedule to auto-fill the lineup ── */}
      {kind === "festival" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel hint="image or PDF · LLM extracts the lineup" optional>Poster or Schedule</FieldLabel>
          <div style={{
            padding: "12px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}>
            <input
              ref={festivalFileInputRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={handleFestivalFileChange}
              style={{ display: "none" }}
            />
            <button
              type="button"
              onClick={() => festivalFileInputRef.current?.click()}
              disabled={festivalFlow.phase === "extracting"}
              style={{
                fontFamily: mono,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--accent-text)",
                background: "var(--accent)",
                border: "none",
                padding: "9px 14px",
                cursor: festivalFlow.phase === "extracting" ? "wait" : "pointer",
                letterSpacing: ".08em",
                textTransform: "uppercase",
                opacity: festivalFlow.phase === "extracting" ? 0.6 : 1,
              }}
            >
              {festivalFlow.phase === "extracting" ? "Reading…" : "Upload poster"}
            </button>
            <span style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", letterSpacing: ".04em" }}>
              {festivalFlow.rows.length > 0
                ? `${festivalFlow.rows.length} artists extracted · ${performers.length} added`
                : "drop the poster image or schedule PDF — pick who you saw"}
            </span>
            {festivalFlow.rows.length > 0 && festivalFlow.phase !== "extracting" && (
              <button
                type="button"
                onClick={() => setFestivalModalOpen(true)}
                style={{
                  fontFamily: mono,
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "var(--muted)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  textDecoration: "underline",
                  textDecorationColor: "var(--rule-strong)",
                  textUnderlineOffset: 3,
                }}
              >
                Reopen picker
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Lineup / Headliner (still WHAT) ── */}
      <div style={{ marginBottom: 26 }}>
        <FieldLabel hint={kind === "theatre" ? "lead performer" : "click role to toggle"}>{kind === "theatre" ? "Cast" : "Lineup"}</FieldLabel>
        <div style={{ border: `1px solid var(--rule-strong)` }}>
          {/* Headliner input row */}
          <div style={{
            padding: "12px 16px",
            background: headliner.name ? "var(--surface)" : "transparent",
            borderLeft: headliner.name ? `2px solid ${kind ? kindColor(kind) : "var(--ink)"}` : "2px solid transparent",
            display: "grid",
            gridTemplateColumns: "18px 1fr auto",
            columnGap: 14,
            alignItems: "center",
          }}>
            <div style={{ color: "var(--faint)", fontFamily: mono, fontSize: 11 }}>⋮⋮</div>
            <input
              type="text"
              placeholder="Search for an artist or show..."
              value={headlinerName}
              onChange={(e) => handleHeadlinerInput(e.target.value)}
              autoFocus
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                fontWeight: headliner.name ? 600 : 400,
                color: headliner.name ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.15,
                width: "100%",
              }}
            />
            <div style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: "var(--muted)",
              letterSpacing: ".06em",
              textTransform: "uppercase",
            }}>
              headliner
            </div>
          </div>

          {/* Search results dropdown — for festivals we surface artists
              (TM attractions), not events. Events would drag in a venue /
              date / kind from a single show, which is wrong for a festival
              lineup built up artist-by-artist. */}
          {debouncedQuery.length >= 2 && (
            <div style={{ borderTop: `1px solid var(--rule)` }}>
              {/* Manual entry option */}
              <button
                type="button"
                onClick={useManualHeadliner}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid var(--rule)`,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                  Use &quot;{headlinerName}&quot;
                </span>
                <span style={{ fontFamily: mono, fontSize: 10, color: "var(--faint)" }}>
                  enter details manually
                </span>
              </button>

              {kind === "festival" ? (
                <>
                  {festivalHeadlinerSearch.isLoading && (
                    <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--muted)" }}>
                      Searching artists...
                    </div>
                  )}
                  {festivalHeadlinerSearch.data && festivalHeadlinerSearch.data.length > 0 && festivalHeadlinerSearch.data.map((artist) => (
                    <button
                      key={artist.tmAttractionId}
                      type="button"
                      onClick={() => handleSelectArtistAsHeadliner(artist)}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: "transparent",
                        border: "none",
                        borderBottom: `1px solid var(--rule)`,
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      {artist.imageUrl && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={artist.imageUrl} alt="" style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 2 }} />
                      )}
                      <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                        {artist.name}
                      </div>
                    </button>
                  ))}
                  {festivalHeadlinerSearch.data && festivalHeadlinerSearch.data.length === 0 && (
                    <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--faint)" }}>
                      No matching artists found
                    </div>
                  )}
                </>
              ) : (
                <>
                  {tmSearch.isLoading && (
                    <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--muted)" }}>
                      Searching upcoming events...
                    </div>
                  )}
                  {tmSearch.data && tmSearch.data.length > 0 && tmSearch.data.map((result) => (
                    <button
                      key={result.tmEventId}
                      type="button"
                      onClick={() => {
                        handleSelectTmResult(result);
                        clearHeadlinerSearch();
                      }}
                      style={{
                        width: "100%",
                        padding: "10px 16px",
                        background: selectedTmEvent?.tmEventId === result.tmEventId
                          ? "var(--surface)"
                          : "transparent",
                        border: "none",
                        borderBottom: `1px solid var(--rule)`,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                        {result.name}
                      </div>
                      <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                        {result.venueName && `${result.venueName}`}
                        {result.venueCity && ` · ${result.venueCity}`}
                        {result.date && ` · ${result.date}`}
                      </div>
                    </button>
                  ))}
                  {tmSearch.data && tmSearch.data.length === 0 && (
                    <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--faint)" }}>
                      No upcoming events found
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Existing performers as chips */}
          {performers.map((p, i) => (
            <div
              key={`${p.name}-${i}`}
              style={{
                display: "grid",
                gridTemplateColumns: "18px 1fr auto auto 18px",
                alignItems: "center",
                columnGap: 14,
                padding: "12px 16px",
                background: p.role === "headliner" ? "var(--surface)" : "transparent",
                borderLeft: p.role === "headliner" ? `2px solid ${kind ? kindColor(kind) : "var(--ink)"}` : "2px solid transparent",
                borderTop: `1px solid var(--rule)`,
              }}
            >
              <div style={{ color: "var(--faint)", fontFamily: mono, fontSize: 11 }}>⋮⋮</div>
              <div>
                <div style={{ fontFamily: sans, fontSize: 14, fontWeight: p.role === "headliner" ? 600 : 500, color: "var(--ink)", letterSpacing: -0.15 }}>
                  {p.name}
                </div>
              </div>
              {p.role === "cast" ? (
                <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
                  {p.role}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => handleTogglePerformerRole(i)}
                  title="Toggle headliner / support"
                  style={{
                    fontFamily: mono,
                    fontSize: 10.5,
                    color: "var(--muted)",
                    letterSpacing: ".06em",
                    textTransform: "uppercase",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  {p.role}
                </button>
              )}
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: p.tmAttractionId ? "var(--kind-festival)" : "var(--faint)",
                letterSpacing: ".04em",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}>
                {p.tmAttractionId ? "✓ matched" : "no match"}
              </div>
              <button
                type="button"
                onClick={() => handleRemovePerformer(i)}
                style={{
                  color: "var(--faint)",
                  fontFamily: mono,
                  fontSize: 13,
                  cursor: "pointer",
                  background: "none",
                  border: "none",
                  padding: 0,
                }}
              >
                x
              </button>
            </div>
          ))}

          {/* Search input for adding performers */}
          <div style={{
            padding: "12px 16px",
            borderTop: `1px solid var(--rule)`,
            background: "transparent",
            display: "grid",
            gridTemplateColumns: "18px 1fr auto",
            columnGap: 14,
            alignItems: "center",
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>+</span>
            <input
              type="text"
              placeholder="search artists..."
              value={performerSearchInput}
              onChange={(e) => handlePerformerSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddPerformer();
                }
              }}
              style={{
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: "var(--ink)",
                letterSpacing: -0.1,
                width: "100%",
              }}
            />
            {kind === "concert" && (
              <div style={{
                fontFamily: mono,
                fontSize: 10,
                color: "var(--faint)",
                letterSpacing: ".06em",
                padding: "2px 6px",
                border: `1px solid var(--rule-strong)`,
                textTransform: "uppercase",
              }}>
                setlist.fm
              </div>
            )}
          </div>

          {/* Artist (TM attraction) search dropdown for support performers.
              Surfaces artists not events — picking one preserves the
              tmAttractionId / musicbrainzId / image so the row shows
              "✓ matched" instead of "no match". */}
          {debouncedPerformerQuery.length >= 2 && (
            <div style={{ borderTop: `1px solid var(--rule)` }}>
              <button
                type="button"
                onClick={handleAddPerformer}
                style={{
                  width: "100%",
                  padding: "10px 16px",
                  background: "transparent",
                  border: "none",
                  borderBottom: `1px solid var(--rule)`,
                  cursor: "pointer",
                  textAlign: "left",
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                  Add &quot;{performerSearchInput}&quot;
                </span>
                <span style={{ fontFamily: mono, fontSize: 10, color: "var(--faint)" }}>
                  enter manually
                </span>
              </button>
              {performerArtistSearch.isLoading && (
                <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--muted)" }}>
                  Searching artists...
                </div>
              )}
              {performerArtistSearch.data && performerArtistSearch.data.length > 0 && performerArtistSearch.data.map((artist) => (
                <button
                  key={artist.tmAttractionId}
                  type="button"
                  onClick={() => handleSelectArtistAsPerformer(artist)}
                  style={{
                    width: "100%",
                    padding: "10px 16px",
                    background: "transparent",
                    border: "none",
                    borderBottom: `1px solid var(--rule)`,
                    cursor: "pointer",
                    textAlign: "left",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  {artist.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={artist.imageUrl} alt="" style={{ width: 24, height: 24, objectFit: "cover", borderRadius: 2 }} />
                  )}
                  <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                    {artist.name}
                  </div>
                </button>
              ))}
              {performerArtistSearch.data && performerArtistSearch.data.length === 0 && !performerArtistSearch.isLoading && (
                <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--faint)" }}>
                  No matching artists found
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── WHERE ── */}
      <SectionLabel>Where</SectionLabel>

      {/* Venue */}
      <div style={{ marginBottom: 26, position: "relative" }}>
        <FieldLabel hint={tmEnriched ? "auto · from ticket" : venue.googlePlaceId ? "auto · google places" : undefined}>Venue</FieldLabel>
        <div style={{
          padding: "10px 14px",
          background: "var(--surface)",
          border: `1px solid var(--rule-strong)`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}>
          <span style={{ color: "var(--muted)", fontSize: 14 }}>📍</span>
          <input
            type="text"
            placeholder="Search for a venue..."
            value={tmEnriched ? `${venue.name}${venue.city ? ` · ${venue.city}` : ""}` : venueQuery}
            onChange={(e) => {
              if (tmEnriched) return;
              handleVenueInput(e.target.value);
            }}
            readOnly={tmEnriched}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontFamily: sans,
              fontSize: 14,
              color: venue.name ? "var(--ink)" : "var(--faint)",
              letterSpacing: -0.1,
            }}
          />
        </div>
        {debouncedVenueQuery.length >= 2 && !tmEnriched && (
          <div style={{
            position: "absolute", top: "100%", left: 0, right: 0, zIndex: 20,
            background: "var(--surface)", border: "1px solid var(--rule-strong)", borderTop: "none",
            maxHeight: 240, overflow: "auto",
          }}>
            {venueSearch.isLoading && (
              <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--muted)" }}>
                Searching venues...
              </div>
            )}
            {venueSearch.data?.map((place) => (
              <button
                key={place.placeId}
                type="button"
                onClick={() => handleSelectPlace(place.placeId)}
                style={{
                  width: "100%", padding: "10px 16px", background: "transparent",
                  border: "none", borderBottom: "1px solid var(--rule)", cursor: "pointer", textAlign: "left",
                }}
              >
                <div style={{ fontFamily: sans, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                  {place.displayName}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                  {place.formattedAddress}
                </div>
              </button>
            ))}
            {venueSearch.data && venueSearch.data.length === 0 && (
              <div style={{ padding: "10px 16px", fontFamily: mono, fontSize: 10.5, color: "var(--faint)" }}>
                No venues found
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── WHEN ── */}
      <SectionLabel>When</SectionLabel>

      {/* Date + Timeframe (side by side) */}
      <div style={{ marginBottom: 26 }}>
        <div style={{ display: "grid", gridTemplateColumns: isEditMode ? "1fr" : "minmax(160px, 200px) 1fr", gap: 14, alignItems: "start" }}>
          <div>
            <FieldLabel>Date</FieldLabel>
            <div style={{
              padding: "10px 14px",
              background: "var(--surface)",
              border: `1px solid var(--rule-strong)`,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}>
              <span style={{ color: "var(--muted)", fontSize: 14 }}>📅</span>
              <input
                type="date"
                value={date}
                onChange={(e) => handleDateChange(e.target.value)}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  fontFamily: mono,
                  fontSize: 13,
                  color: date ? "var(--ink)" : "var(--faint)",
                  letterSpacing: -0.1,
                  minWidth: 0,
                }}
              />
            </div>
          </div>
          {!isEditMode && (
            <div>
              <FieldLabel>Timeframe</FieldLabel>
              <div style={{ display: "flex", gap: 6 }}>
                {TIMEFRAME_CONFIG.map((tf) => {
                  const active = timeframe === tf.key;
                  return (
                    <button
                      key={tf.key}
                      type="button"
                      onClick={() => {
                        timeframeManuallySet.current = true;
                        setTimeframe(tf.key);
                      }}
                      style={{
                        flex: 1,
                        padding: "10px 10px",
                        background: active ? "var(--surface)" : "transparent",
                        border: `1px solid ${active ? "var(--rule-strong)" : "var(--rule)"}`,
                        borderLeft: active ? "2px solid var(--ink)" : "2px solid transparent",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <div style={{
                        fontFamily: sans,
                        fontSize: 13,
                        fontWeight: active ? 600 : 500,
                        color: active ? "var(--ink)" : "var(--muted)",
                        letterSpacing: -0.2,
                      }}>
                        {tf.label}
                      </div>
                      <div style={{
                        fontFamily: mono,
                        fontSize: 10,
                        color: "var(--faint)",
                        letterSpacing: ".04em",
                        marginTop: 2,
                      }}>
                        {tf.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Festival: End Date — sized to match the Date field above */}
      {kind === "festival" && (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(160px, 200px) 1fr", gap: 14, alignItems: "start" }}>
            <div>
              <FieldLabel>End Date</FieldLabel>
              <div style={{
                padding: "10px 14px",
                background: "var(--surface)",
                border: `1px solid var(--rule-strong)`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <span style={{ color: "var(--muted)", fontSize: 14 }}>📅</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontFamily: mono,
                    fontSize: 13,
                    color: endDate ? "var(--ink)" : "var(--faint)",
                    minWidth: 0,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DETAILS ── */}
      <SectionLabel>Details</SectionLabel>

      {/* Tour name — festivals don't have tours */}
      {kind !== "festival" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel hint={setlistQuery.data?.tourName ? "auto · setlist.fm" : undefined} optional>Tour</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}>
            <span style={{ color: "var(--muted)", fontSize: 14 }}>♫</span>
            <input
              type="text"
              placeholder="e.g. Romance World Tour"
              value={tourName}
              onChange={(e) => setTourName(e.target.value)}
              style={{
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: tourName ? "var(--ink)" : "var(--faint)",
                letterSpacing: -0.1,
                width: "100%",
              }}
            />
          </div>
        </div>
      )}

      {/* Notes */}
      <div style={{ marginBottom: 26 }}>
        <FieldLabel optional>Notes</FieldLabel>
        <div style={{
          padding: "10px 14px",
          background: "var(--surface)",
          border: `1px solid var(--rule-strong)`,
        }}>
          <textarea
            placeholder="Anything to remember about this show — observations, rating, setlist surprises…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            style={{
              width: "100%",
              minHeight: 80,
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "vertical",
              fontFamily: sans,
              fontSize: 14,
              color: notes ? "var(--ink)" : "var(--faint)",
              letterSpacing: -0.1,
              lineHeight: 1.5,
            }}
          />
        </div>
      </div>

      {/* Photos & videos (staged for upload after save) — only for past events */}
      {isPastEvent && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel optional>Photos & videos</FieldLabel>
          <MediaUploadSection
            media={media}
            disabled={createShow.isPending}
            lineupNames={[
              ...(headliner.name ? [headliner.name] : []),
              ...performers.map((p) => p.name).filter(Boolean),
            ]}
          />
        </div>
      )}

      {/* Comedy: opener */}
      {kind === "comedy" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel optional>Opener</FieldLabel>
          <div style={{
            padding: "10px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
          }}>
            <input
              type="text"
              placeholder="Opening act name"
              value={openerName}
              onChange={(e) => setOpenerName(e.target.value)}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                fontFamily: sans,
                fontSize: 14,
                color: "var(--ink)",
              }}
            />
          </div>
        </div>
      )}

      {/* Theatre: playbill upload */}
      {kind === "theatre" && (
        <div style={{ marginBottom: 26 }}>
          <FieldLabel hint="OCR cast extraction" optional>Playbill Photo</FieldLabel>
          <div style={{
            padding: "12px 14px",
            background: "var(--surface)",
            border: `1px solid var(--rule-strong)`,
          }}>
            <input
              type="file"
              accept="image/*"
              onChange={handlePlaybillUpload}
              style={{
                fontFamily: mono,
                fontSize: 12,
                color: "var(--muted)",
                cursor: "pointer",
              }}
            />
            {extractCast.isPending && (
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "var(--muted)", marginTop: 8 }}>
                Extracting cast from photo...
              </div>
            )}
            {extractCast.isError && (
              <div style={{ fontFamily: mono, fontSize: 10.5, color: "#E63946", marginTop: 8 }}>
                Could not extract cast. Add manually above.
              </div>
            )}
          </div>
          {castMembers.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontFamily: mono, fontSize: 10, color: "var(--faint)", letterSpacing: ".06em", marginBottom: 6, textTransform: "uppercase" }}>
                Extracted Cast
              </div>
              {castMembers.map((c, i) => (
                <div key={i} style={{ marginBottom: 4, display: "flex", gap: 8 }}>
                  <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>{c.actor}</span>
                  <span style={{ fontFamily: mono, fontSize: 11, color: "var(--muted)" }}>as {c.role}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Setlist — per-performer (past concerts) ── */}
      {isPastConcert && (kind === "concert") && (
        <div style={{ marginBottom: 26 }} data-testid="setlist-section">
          <FieldLabel hint="one block per performer">Setlist</FieldLabel>
          {/* Headliner block */}
          {headliner.name && (
            <PerformerSetlistBlock
              performerName={headliner.name}
              setlist={setlistsByPerformer[headliner.name] ?? null}
              loading={setlistQuery.isLoading}
              fetchingFor={fetchingSetlistFor}
              onFetch={async () => {
                setFetchingSetlistFor((prev) => ({ ...prev, [headliner.name]: true }));
                try {
                  const result = await utils.enrichment.fetchSetlist.fetch({
                    performerName: headliner.name,
                    date,
                  });
                  if (!result) return;
                  if (result.mbid) {
                    setHeadliner((prev) =>
                      prev.musicbrainzId === result.mbid
                        ? prev
                        : { ...prev, musicbrainzId: result.mbid },
                    );
                  }
                  if (result.setlist && setlistTotalSongs(result.setlist) > 0) {
                    setSetlistsByPerformer((prev) => ({
                      ...prev,
                      [headliner.name]: result.setlist!,
                    }));
                    if (result.tourName) setTourName(result.tourName);
                  }
                } finally {
                  setFetchingSetlistFor((prev) => ({ ...prev, [headliner.name]: false }));
                }
              }}
              onChange={(next) =>
                setSetlistsByPerformer((prev) => ({ ...prev, [headliner.name]: next }))
              }
            />
          )}
          {/* Support performer blocks */}
          {performers
            .filter((p) => p.role === "support")
            .map((p) => (
              <PerformerSetlistBlock
                key={p.name}
                performerName={p.name}
                setlist={setlistsByPerformer[p.name] ?? null}
                loading={false}
                fetchingFor={fetchingSetlistFor}
                onFetch={async () => {
                  setFetchingSetlistFor((prev) => ({ ...prev, [p.name]: true }));
                  try {
                    const result = await utils.enrichment.fetchSetlist.fetch({
                      performerName: p.name,
                      date,
                    });
                    if (!result) return;
                    if (result.mbid) {
                      setPerformers((prev) =>
                        prev.map((pp) =>
                          pp.name === p.name && !pp.musicbrainzId
                            ? { ...pp, musicbrainzId: result.mbid }
                            : pp,
                        ),
                      );
                    }
                    if (result.setlist && setlistTotalSongs(result.setlist) > 0) {
                      setSetlistsByPerformer((prev) => ({
                        ...prev,
                        [p.name]: result.setlist!,
                      }));
                    }
                  } finally {
                    setFetchingSetlistFor((prev) => ({ ...prev, [p.name]: false }));
                  }
                }}
                onChange={(next) =>
                  setSetlistsByPerformer((prev) => ({ ...prev, [p.name]: next }))
                }
              />
            ))}
        </div>
      )}

      {/* ── More details (collapsible: seat, tickets, price) ── */}
      <div style={{ marginBottom: 26 }}>
        <button
          type="button"
          onClick={() => setShowMoreDetails((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "6px 0",
            fontFamily: mono,
            fontSize: 10.5,
            color: "var(--muted)",
            letterSpacing: ".06em",
            textTransform: "uppercase",
          }}
        >
          <span style={{
            display: "inline-block",
            transform: showMoreDetails ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
            fontSize: 8,
          }}>▶</span>
          More details
          {((seat && kind !== "festival") || pricePaid) && !showMoreDetails && (
            <span style={{ color: "var(--faint)", fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>
              · {[seat && kind !== "festival" && "seat", pricePaid && "price"].filter(Boolean).join(", ")}
            </span>
          )}
        </button>
        {showMoreDetails && (
          <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14 }}>
            {kind !== "festival" && (
              <div>
                <FieldLabel optional>Seat</FieldLabel>
                <div style={{
                  padding: "10px 14px",
                  background: "var(--surface)",
                  border: `1px solid var(--rule-strong)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <span style={{ color: "var(--muted)", fontSize: 14 }}>🎫</span>
                  <input
                    type="text"
                    placeholder="e.g. ORCH L · 14"
                    value={seat}
                    onChange={(e) => setSeat(e.target.value)}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "none",
                      outline: "none",
                      fontFamily: mono,
                      fontSize: 13,
                      color: seat ? "var(--ink)" : "var(--faint)",
                      letterSpacing: -0.1,
                      width: "100%",
                    }}
                  />
                </div>
              </div>
            )}
            <div>
              <FieldLabel optional>Tickets</FieldLabel>
              <div style={{
                padding: "10px 14px",
                background: "var(--surface)",
                border: `1px solid var(--rule-strong)`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <input
                  type="number"
                  placeholder="1"
                  value={ticketCount}
                  onChange={(e) => setTicketCount(e.target.value)}
                  min="1"
                  step="1"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontFamily: mono,
                    fontSize: 13,
                    color: ticketCount && ticketCount !== "1" ? "var(--ink)" : "var(--faint)",
                    letterSpacing: -0.1,
                    width: "100%",
                    textAlign: "center",
                  }}
                />
              </div>
            </div>
            <div>
              <FieldLabel optional>Total cost</FieldLabel>
              <div style={{
                padding: "10px 14px",
                background: "var(--surface)",
                border: `1px solid var(--rule-strong)`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <span style={{ color: "var(--muted)", fontSize: 14 }}>$</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={pricePaid}
                  onChange={(e) => setPricePaid(e.target.value)}
                  min="0"
                  step="0.01"
                  style={{
                    flex: 1,
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    fontFamily: mono,
                    fontSize: 13,
                    color: pricePaid ? "var(--ink)" : "var(--faint)",
                    letterSpacing: -0.1,
                    width: "100%",
                  }}
                />
                <span style={{ fontFamily: mono, fontSize: 10, color: "var(--faint)", letterSpacing: ".04em" }}>USD</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Commit Bar ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 8,
        paddingTop: 18,
        borderTop: `1px solid var(--rule)`,
      }}>
        <div style={{
          fontFamily: mono,
          fontSize: 10.5,
          color: "var(--faint)",
          letterSpacing: ".04em",
          flex: 1,
        }}>
          {isEditMode
            ? (updateShow.isError ? "1 error" : "0 errors")
            : !canSave
              ? <>missing: {[
                  !kind && "kind",
                  !hasIdentity && ((kind === "theatre" || kind === "festival") ? "title" : "headliner"),
                  !venue.name && "venue",
                  venue.name && !venue.city && "venue city",
                  !date && "date",
                ].filter(Boolean).join(", ")}</>
              : <>{autoFilledCount} fields auto-filled · {createShow.isError ? "1 error" : "0 errors"}</>
          }
        </div>
        <button
          type="button"
          onClick={() => router.back()}
          style={{
            padding: "9px 14px",
            border: `1px solid var(--rule-strong)`,
            background: "transparent",
            color: "var(--muted)",
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleFormSave}
          disabled={!canSave || createShow.isPending || updateShow.isPending || Boolean(media.mediaUploadStatus)}
          style={{
            padding: "9px 16px",
            background: canSave ? "var(--ink)" : "var(--surface2)",
            color: canSave ? "var(--bg)" : "var(--faint)",
            fontFamily: mono,
            fontSize: 11,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            fontWeight: 500,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            cursor: canSave ? "pointer" : "not-allowed",
            border: "none",
            opacity: (createShow.isPending || updateShow.isPending || Boolean(media.mediaUploadStatus)) ? 0.6 : 1,
          }}
        >
          {(createShow.isPending || updateShow.isPending)
            ? "Saving..."
            : media.mediaUploadStatus
              ? "Uploading..."
              : isEditMode ? "Save changes" : "✓ Save to history"}
        </button>
      </div>

      {(createShow.isError || updateShow.isError) && (
        <div style={{ color: "#E63946", fontSize: 12, fontFamily: mono, marginTop: 8 }}>
          Failed to save show. Please try again.
        </div>
      )}
    </>
  );

  // ── Main Render ────────────────────────────────────────────

  if (isEditMode && editQuery.isLoading) {
    return (
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--muted)",
        fontFamily: mono,
        fontSize: 12,
        letterSpacing: ".06em",
      }}>
        Loading show...
      </div>
    );
  }

  return (
    <>
    <style>{`
      .add-outer { display: flex; flex-direction: column; height: 100%; min-height: 100vh; background: var(--bg); color: var(--ink); font-family: ${sans}; -webkit-font-smoothing: antialiased; }
      .add-layout { flex: 1; display: grid; grid-template-columns: 1fr 440px; min-height: 0; overflow: hidden; }
      .add-preview-panel { min-width: 0; border-left: 1px solid var(--rule); background: var(--bg); overflow: auto; }
      @media (max-width: 960px) {
        .add-layout { grid-template-columns: 1fr; overflow: visible; }
        .add-preview-panel { display: none; }
      }
    `}</style>
    <div className="add-outer">
      {/* Top bar / Breadcrumb */}
      <div style={{
        padding: "14px 32px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: `1px solid var(--rule)`,
        flexShrink: 0,
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontFamily: mono,
          fontSize: 11.5,
          color: "var(--muted)",
          letterSpacing: ".04em",
        }}>
          <span style={{ cursor: "pointer" }} onClick={() => router.push("/home")}>home</span>
          <span style={{ color: "var(--faint)" }}>&gt;</span>
          <span style={{ color: "var(--ink)", fontWeight: 500 }}>{isEditMode ? "edit" : "add a show"}</span>
          {!isEditMode && (
            <>
              <span style={{ color: "var(--faint)" }}>·</span>
              <span style={{ color: "var(--faint)" }}>draft · autosaved 2s ago</span>
            </>
          )}
        </div>
        <div style={{
          display: "flex",
          gap: 14,
          alignItems: "center",
          fontFamily: mono,
          fontSize: 11,
          color: "var(--muted)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "var(--kind-festival)",
              display: "inline-block",
            }} />
            5 sources connected
          </span>
        </div>
      </div>

      {/* 2-column layout */}
      <div className="add-layout">
        {/* Left: Form */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", overflow: "auto" }}>
          {renderFormPanel()}
        </div>

        {/* Right: Live Preview + Provenance */}
        <div className="add-preview-panel">
          <LivePreview
            kind={kind}
            date={date}
            venue={venue}
            headliner={headliner}
            productionName={productionName}
            performers={performers}
            seat={seat}
            pricePaid={pricePaid}
            ticketCount={ticketCount}
            tourName={tourName}
            setlistsByPerformer={setlistsByPerformer}
            stagedMedia={media.stagedMedia}
            provenanceStatuses={provenanceStatuses}
            isEditMode={isEditMode}
          />
        </div>
      </div>
    </div>
    <FestivalLineupModal
      open={festivalModalOpen}
      onClose={() => setFestivalModalOpen(false)}
      flow={festivalFlow}
      submitLabel="Add to show"
    />
    </>
  );
}

// ── Sub-components ───────────────────────────────────────────

function FieldLabel({
  children,
  hint,
  optional,
}: {
  children: React.ReactNode;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <div style={{
      display: "flex",
      alignItems: "baseline",
      justifyContent: "space-between",
      marginBottom: 8,
    }}>
      <div style={{
        fontFamily: "var(--font-geist-mono), monospace",
        fontSize: 10.5,
        color: "var(--ink)",
        letterSpacing: ".08em",
        textTransform: "uppercase",
        fontWeight: 500,
        display: "flex",
        gap: 8,
        alignItems: "center",
      }}>
        {children}
        {optional && (
          <span style={{ color: "var(--faint)", fontWeight: 400 }}>· optional</span>
        )}
      </div>
      {hint && (
        <div style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10,
          color: "var(--faint)",
          letterSpacing: ".02em",
        }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: "var(--font-geist-mono), monospace",
      fontSize: 9.5,
      color: "var(--faint)",
      letterSpacing: ".14em",
      textTransform: "uppercase",
      fontWeight: 600,
      marginBottom: 14,
      marginTop: 4,
      paddingBottom: 7,
      borderBottom: "1px solid var(--rule)",
    }}>
      {children}
    </div>
  );
}
