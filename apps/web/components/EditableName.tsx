"use client";

import { useEffect, useRef, useState } from "react";

export function EditableName({
  value,
  onSave,
}: {
  value: string;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== value) {
      onSave(trimmed);
    } else {
      setDraft(value);
    }
  }

  const sharedStyle: React.CSSProperties = {
    fontFamily: "var(--font-geist-sans), sans-serif",
    fontSize: 48,
    fontWeight: 600,
    color: "var(--ink)",
    letterSpacing: -1.6,
    lineHeight: 0.98,
    marginTop: 10,
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        style={{
          ...sharedStyle,
          width: "100%",
          background: "transparent",
          border: "none",
          borderBottom: "2px solid var(--accent)",
          outline: "none",
          padding: 0,
        }}
      />
    );
  }

  return (
    <div
      onDoubleClick={() => setEditing(true)}
      style={{ ...sharedStyle, cursor: "text" }}
      title="Double-click to edit"
    >
      {value}
    </div>
  );
}
