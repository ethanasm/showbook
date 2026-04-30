"use client";

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { trpc } from "@/lib/trpc";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import type { PerformerSetlist } from "@showbook/shared";

// ── Internal model ──────────────────────────────────────────────────────────
//
// The wire shape `PerformerSetlist` is `{ sections: [{kind, songs}] }`. For a
// single-encore product, drag-and-drop is much simpler if we flatten the
// sections to a single array of items + a sortable "ENCORE" divider whose
// array index implicitly determines the boundary. Items above the divider
// are main set; items below are encore. No divider = no encore.
//
// On save we re-section based on the divider position. This keeps the wire
// format clean (the canonical sections shape) while letting the editor use
// one SortableContext for cross-section dragging.

export type SongRow = {
  kind: "song";
  /** Stable client-side id; not persisted. */
  id: string;
  title: string;
  note?: string;
};

export type DividerRow = {
  kind: "divider";
  id: "encore-divider";
};

export type Row = SongRow | DividerRow;

export const DIVIDER_ID = "encore-divider" as const;

let nextRowId = 0;
export function makeRowId(): string {
  nextRowId += 1;
  return `r${nextRowId}`;
}

export function setlistToRows(setlist: PerformerSetlist): Row[] {
  const rows: Row[] = [];
  let sawSet = false;
  let sawEncore = false;
  for (const section of setlist.sections) {
    if (section.kind === "encore") {
      // Insert the divider once, when we encounter the first encore section.
      if (!sawEncore) {
        rows.push({ kind: "divider", id: DIVIDER_ID });
        sawEncore = true;
      }
    } else {
      sawSet = true;
    }
    for (const song of section.songs) {
      rows.push({
        kind: "song",
        id: makeRowId(),
        title: song.title,
        ...(song.note ? { note: song.note } : {}),
      });
    }
  }
  // If there's an encore but no main set rows above the divider, that's
  // valid (an encore-only setlist would render as such).
  void sawSet;
  return rows;
}

export function rowsToSetlist(rows: Row[]): PerformerSetlist {
  const dividerIdx = rows.findIndex((r) => r.kind === "divider");
  const mainRows: SongRow[] = [];
  const encoreRows: SongRow[] = [];
  rows.forEach((row, i) => {
    if (row.kind !== "song") return;
    if (dividerIdx === -1 || i < dividerIdx) mainRows.push(row);
    else encoreRows.push(row);
  });

  const sections: PerformerSetlist["sections"] = [];
  if (mainRows.length > 0) {
    sections.push({
      kind: "set",
      songs: mainRows.map(({ title, note }) => ({
        title,
        ...(note ? { note } : {}),
      })),
    });
  }
  if (encoreRows.length > 0) {
    sections.push({
      kind: "encore",
      songs: encoreRows.map(({ title, note }) => ({
        title,
        ...(note ? { note } : {}),
      })),
    });
  }
  return { sections };
}

function rowsEqual(a: Row[], b: Row[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai.kind !== bi.kind) return false;
    if (ai.kind === "song" && bi.kind === "song") {
      if (ai.title !== bi.title || (ai.note ?? "") !== (bi.note ?? "")) {
        return false;
      }
    }
  }
  return true;
}

// ── Sortable row ────────────────────────────────────────────────────────────

function SortableRow({
  row,
  index,
  songNumber,
  onTitleChange,
  onNoteChange,
  onDelete,
  onMarkEncoreHere,
  onRemoveDivider,
  hasDivider,
  isInEncore,
}: {
  row: Row;
  index: number;
  songNumber: number;
  onTitleChange: (id: string, value: string) => void;
  onNoteChange: (id: string, value: string) => void;
  onDelete: (id: string) => void;
  onMarkEncoreHere: (id: string) => void;
  onRemoveDivider: () => void;
  hasDivider: boolean;
  isInEncore: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  if (row.kind === "divider") {
    return (
      <div
        ref={setNodeRef}
        style={{ ...style }}
        data-testid="setlist-encore-divider"
        {...attributes}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr auto auto",
            alignItems: "center",
            gap: 10,
            margin: "10px 0",
          }}
        >
          <button
            type="button"
            aria-label="Reorder encore divider"
            data-testid="encore-divider-drag-handle"
            {...listeners}
            style={{
              cursor: "grab",
              background: "transparent",
              border: "none",
              color: "var(--faint)",
              padding: 4,
              display: "flex",
              alignItems: "center",
            }}
          >
            <GripVertical size={14} />
          </button>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              borderTop: "1px solid var(--rule-strong)",
              paddingTop: 0,
            }}
          >
            <span
              style={{
                background: "var(--accent-bg, var(--surface2))",
                color: "var(--accent)",
                padding: "2px 10px",
                fontFamily: "var(--font-geist-mono), monospace",
                fontSize: 10,
                letterSpacing: ".1em",
                fontWeight: 600,
                textTransform: "uppercase",
                borderRadius: 999,
                border: "1px solid var(--accent)",
              }}
            >
              Encore
            </span>
          </div>
          <span />
          <button
            type="button"
            onClick={onRemoveDivider}
            data-testid="encore-divider-remove"
            style={{
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              color: "var(--muted)",
              padding: "3px 8px",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            no encore
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        display: "grid",
        gridTemplateColumns: "auto 32px 1fr auto auto",
        columnGap: 10,
        alignItems: "center",
        padding: "8px 10px",
        background: isInEncore ? "var(--surface2)" : "var(--surface)",
        border: "1px solid var(--rule)",
        borderTop: index === 0 ? "1px solid var(--rule)" : "none",
      }}
      data-testid={`setlist-row-${row.id}`}
      data-encore={isInEncore ? "true" : "false"}
      {...attributes}
    >
      <button
        type="button"
        aria-label="Drag to reorder"
        data-testid={`setlist-row-handle-${row.id}`}
        {...listeners}
        style={{
          cursor: "grab",
          background: "transparent",
          border: "none",
          color: "var(--faint)",
          padding: 4,
          display: "flex",
          alignItems: "center",
        }}
      >
        <GripVertical size={14} />
      </button>
      <span
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 11,
          color: "var(--faint)",
          letterSpacing: ".04em",
          fontFeatureSettings: '"tnum"',
        }}
      >
        {String(songNumber).padStart(2, "0")}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <input
          type="text"
          value={row.title}
          onChange={(e) => onTitleChange(row.id, e.target.value)}
          placeholder="Song title"
          data-testid={`setlist-row-title-${row.id}`}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--ink)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 14,
            fontWeight: 500,
            letterSpacing: -0.1,
            padding: 0,
          }}
        />
        <input
          type="text"
          value={row.note ?? ""}
          onChange={(e) => onNoteChange(row.id, e.target.value)}
          placeholder="add a note (optional)"
          data-testid={`setlist-row-note-${row.id}`}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--muted)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12,
            padding: 0,
          }}
        />
      </div>
      {!hasDivider && !isInEncore && (
        <button
          type="button"
          onClick={() => onMarkEncoreHere(row.id)}
          data-testid={`setlist-row-mark-encore-${row.id}`}
          title="Mark this song (and below) as the encore"
          style={{
            background: "transparent",
            border: "1px solid var(--rule-strong)",
            color: "var(--muted)",
            padding: "3px 8px",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          encore
        </button>
      )}
      <button
        type="button"
        onClick={() => onDelete(row.id)}
        aria-label="Remove song"
        data-testid={`setlist-row-delete-${row.id}`}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--muted)",
          padding: 4,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

export function SetlistSectionsEditor({
  showId,
  performerId,
  performerName,
  initialSetlist,
}: {
  showId: string;
  performerId: string;
  performerName: string;
  initialSetlist: PerformerSetlist;
}) {
  const utils = trpc.useUtils();
  const [rows, setRows] = useState<Row[]>(() => setlistToRows(initialSetlist));
  const [error, setError] = useState<string | null>(null);
  const initialRows = useMemo(() => setlistToRows(initialSetlist), [initialSetlist]);

  // Reset draft when the underlying setlist changes (e.g. tab switch).
  useEffect(() => {
    setRows(setlistToRows(initialSetlist));
    setError(null);
  }, [initialSetlist]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const setSetlist = trpc.shows.setSetlist.useMutation({
    onSuccess: () => {
      utils.shows.detail.invalidate({ showId });
      utils.shows.invalidate();
      setError(null);
    },
    onError: (err) => setError(err.message),
  });

  const dividerIdx = rows.findIndex((r) => r.kind === "divider");
  const hasDivider = dividerIdx !== -1;
  const dirty = !rowsEqual(rows, initialRows);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = rows.findIndex((r) => r.id === active.id);
    const to = rows.findIndex((r) => r.id === over.id);
    if (from === -1 || to === -1) return;
    setRows((prev) => arrayMove(prev, from, to));
  }

  function updateTitle(id: string, value: string) {
    setRows((prev) =>
      prev.map((r) => (r.kind === "song" && r.id === id ? { ...r, title: value } : r)),
    );
  }

  function updateNote(id: string, value: string) {
    setRows((prev) =>
      prev.map((r) =>
        r.kind === "song" && r.id === id ? { ...r, note: value } : r,
      ),
    );
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function markEncoreFromRow(id: string) {
    setRows((prev) => {
      // Drop any existing divider, then insert one immediately before `id`.
      const withoutDivider: Row[] = prev.filter((r) => r.kind !== "divider");
      const targetIdx = withoutDivider.findIndex((r) => r.id === id);
      if (targetIdx === -1) return prev;
      const next: Row[] = [...withoutDivider];
      next.splice(targetIdx, 0, { kind: "divider", id: DIVIDER_ID });
      return next;
    });
  }

  function removeDivider() {
    setRows((prev) => prev.filter((r) => r.kind !== "divider"));
  }

  function addSong() {
    setRows((prev) => [
      ...prev,
      { kind: "song", id: makeRowId(), title: "" },
    ]);
  }

  async function save() {
    // Drop empty-title rows before sending.
    const cleanedRows = rows.filter(
      (r) => r.kind === "divider" || r.title.trim().length > 0,
    );
    const setlist = rowsToSetlist(cleanedRows);
    await setSetlist.mutateAsync({ showId, performerId, setlist });
  }

  function reset() {
    setRows(setlistToRows(initialSetlist));
    setError(null);
  }

  async function clear() {
    await setSetlist.mutateAsync({
      showId,
      performerId,
      setlist: { sections: [] },
    });
    setRows([]);
  }

  // Per-row metadata for rendering.
  const rendering = rows.map((row, i) => {
    const isInEncore = hasDivider && i > dividerIdx;
    // Numbering ignores the divider and runs through all songs.
    const songNumber =
      rows.slice(0, i + 1).filter((r) => r.kind === "song").length;
    return { row, i, songNumber, isInEncore };
  });

  const hasSongs = rows.some((r) => r.kind === "song");
  const editorTestId = `setlist-editor-${performerName
    .replace(/\s+/g, "-")
    .toLowerCase()}`;

  // Stable sortable item ids.
  const itemIds = rows.map((r) => r.id);
  const reactDomId = useId();

  return (
    <div
      data-testid={editorTestId}
      style={{
        background: "var(--surface)",
        padding: "12px 14px",
        border: "1px dashed var(--rule-strong)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-geist-mono), monospace",
          fontSize: 10,
          color: "var(--faint)",
          letterSpacing: ".06em",
          textTransform: "uppercase",
          marginBottom: 6,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span>
          drag <GripVertical size={10} style={{ verticalAlign: "middle" }} /> to reorder
        </span>
        <span>{rows.filter((r) => r.kind === "song").length} songs</span>
      </div>

      <DndContext
        id={reactDomId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rendering.map(({ row, i, songNumber, isInEncore }) => (
              <SortableRow
                key={row.id}
                row={row}
                index={i}
                songNumber={songNumber}
                onTitleChange={updateTitle}
                onNoteChange={updateNote}
                onDelete={deleteRow}
                onMarkEncoreHere={markEncoreFromRow}
                onRemoveDivider={removeDivider}
                hasDivider={hasDivider}
                isInEncore={isInEncore}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginTop: 10,
        }}
      >
        <button
          type="button"
          onClick={addSong}
          data-testid="setlist-add-song"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "5px 10px",
            background: "transparent",
            border: "1px dashed var(--rule-strong)",
            color: "var(--muted)",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 10,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          <Plus size={12} /> add song
        </button>
        {!hasDivider && hasSongs && (
          <button
            type="button"
            onClick={() => {
              const lastSong = [...rows].reverse().find((r) => r.kind === "song");
              if (lastSong && lastSong.kind === "song") {
                markEncoreFromRow(lastSong.id);
              }
            }}
            data-testid="setlist-mark-last-as-encore"
            style={{
              padding: "5px 10px",
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              color: "var(--muted)",
              fontFamily: "var(--font-geist-mono), monospace",
              fontSize: 10,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              cursor: "pointer",
            }}
          >
            mark last as encore
          </button>
        )}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={() => void save()}
          disabled={setSetlist.isPending || !dirty}
          data-testid="setlist-save"
          style={{
            padding: "7px 14px",
            background: "var(--accent)",
            color: "var(--accent-text)",
            border: "none",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12,
            fontWeight: 500,
            cursor: setSetlist.isPending || !dirty ? "default" : "pointer",
            opacity: setSetlist.isPending || !dirty ? 0.5 : 1,
          }}
        >
          {setSetlist.isPending ? "Saving…" : "Save setlist"}
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={setSetlist.isPending || !dirty}
          style={{
            padding: "7px 14px",
            background: "transparent",
            border: "1px solid var(--rule-strong)",
            color: "var(--muted)",
            fontFamily: "var(--font-geist-sans), sans-serif",
            fontSize: 12,
            cursor: setSetlist.isPending || !dirty ? "default" : "pointer",
            opacity: setSetlist.isPending || !dirty ? 0.5 : 1,
          }}
        >
          Reset
        </button>
        {hasSongs && (
          <button
            type="button"
            onClick={() => void clear()}
            disabled={setSetlist.isPending}
            data-testid="setlist-clear"
            style={{
              padding: "7px 14px",
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              color: "#E63946",
              fontFamily: "var(--font-geist-sans), sans-serif",
              fontSize: 12,
              cursor: setSetlist.isPending ? "default" : "pointer",
              marginLeft: "auto",
            }}
          >
            Clear setlist
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            color: "#E63946",
            fontFamily: "var(--font-geist-mono), monospace",
            fontSize: 11,
            marginTop: 8,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
