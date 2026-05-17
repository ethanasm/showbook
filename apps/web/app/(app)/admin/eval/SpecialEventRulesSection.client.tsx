"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";

type RuleKind = "date_match" | "venue_run" | "tour_name_pattern";

interface DraftRule {
  performerId: string;
  ruleKind: RuleKind;
  pattern: string; // JSON-encoded pattern object
  copy: string;
  sampleCount: number;
  active: boolean;
}

const EMPTY_DRAFT: DraftRule = {
  performerId: "",
  ruleKind: "date_match",
  pattern: JSON.stringify({ month: 10, day: 31 }, null, 2),
  copy:
    "Halloween is when this artist sometimes plays themed sets — we won't predict this one.",
  sampleCount: 5,
  active: true,
};

/**
 * Phase 11 §15g — admin CRUD for `special_event_rules`. Lives under
 * /admin/eval as a sibling section to the Phase-4 prediction-eval
 * metrics. The operator adds Springsteen NYE / Sphere residency rules
 * here; the 0045 seed only covers Phish Halloween.
 */
export function SpecialEventRulesSection() {
  const list = trpc.eval.listSpecialEventRules.useQuery();
  const upsert = trpc.eval.upsertSpecialEventRule.useMutation({
    onSuccess: () => {
      list.refetch();
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
    },
  });
  const remove = trpc.eval.deleteSpecialEventRule.useMutation({
    onSuccess: () => list.refetch(),
  });

  const [draft, setDraft] = useState<DraftRule>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const rules = useMemo(() => list.data ?? [], [list.data]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setParseError(null);
    let pattern: Record<string, unknown>;
    try {
      pattern = JSON.parse(draft.pattern) as Record<string, unknown>;
    } catch (err) {
      setParseError((err as Error).message);
      return;
    }
    upsert.mutate({
      id: editingId ?? undefined,
      performerId: draft.performerId,
      ruleKind: draft.ruleKind,
      pattern,
      effect: { copy: draft.copy, sampleCount: draft.sampleCount },
      active: draft.active,
    });
  };

  const editingRule = useMemo(
    () => rules.find((r) => r.id === editingId) ?? null,
    [rules, editingId],
  );

  return (
    <section style={styles.wrap}>
      <h2 style={styles.title}>Special event rules</h2>
      <p style={styles.body}>
        When a rule matches a show, the predicted-setlist surface
        replaces its prediction with an explainer card. The 0045
        migration seeds the Phish Halloween rule; add others here as
        you notice them in the wild.
      </p>

      <div style={styles.tableWrap}>
        {rules.length === 0 ? (
          <div style={styles.empty}>No rules yet.</div>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Performer</th>
                <th style={styles.th}>Kind</th>
                <th style={styles.th}>Source</th>
                <th style={styles.th}>Active</th>
                <th style={styles.thActions}></th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td style={styles.td}>{r.performerName}</td>
                  <td style={styles.td}>{r.ruleKind}</td>
                  <td style={styles.td}>{r.source}</td>
                  <td style={styles.td}>{r.active ? "yes" : "no"}</td>
                  <td style={styles.td}>
                    <button
                      type="button"
                      style={styles.btnSecondary}
                      onClick={() => {
                        setEditingId(r.id);
                        setDraft({
                          performerId: r.performerId,
                          ruleKind: r.ruleKind as RuleKind,
                          pattern: JSON.stringify(r.pattern, null, 2),
                          copy:
                            (r.effect as { copy?: string })?.copy ?? "",
                          sampleCount:
                            (r.effect as { sampleCount?: number })
                              ?.sampleCount ?? 5,
                          active: r.active,
                        });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      style={styles.btnDanger}
                      onClick={() => {
                        if (confirm("Delete this rule?")) {
                          remove.mutate({ id: r.id });
                        }
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form onSubmit={onSubmit} style={styles.form}>
        <h3 style={styles.formTitle}>
          {editingId ? `Edit rule ${editingRule?.id.slice(0, 8)}…` : "Add a rule"}
        </h3>
        <label style={styles.field}>
          <span style={styles.label}>Performer ID (UUID)</span>
          <input
            type="text"
            value={draft.performerId}
            onChange={(e) =>
              setDraft((d) => ({ ...d, performerId: e.target.value }))
            }
            style={styles.input}
            required
            placeholder="e.g. 9c8d9f2e-…"
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Rule kind</span>
          <select
            value={draft.ruleKind}
            onChange={(e) =>
              setDraft((d) => ({ ...d, ruleKind: e.target.value as RuleKind }))
            }
            style={styles.input}
          >
            <option value="date_match">date_match (month/day)</option>
            <option value="venue_run">venue_run (venue name substring)</option>
            <option value="tour_name_pattern">tour_name_pattern (regex)</option>
          </select>
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Pattern (JSON)</span>
          <textarea
            value={draft.pattern}
            onChange={(e) =>
              setDraft((d) => ({ ...d, pattern: e.target.value }))
            }
            style={{ ...styles.input, fontFamily: "var(--font-geist-mono), monospace", minHeight: 80 }}
            required
          />
          {parseError ? <span style={styles.err}>{parseError}</span> : null}
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Empty-state copy</span>
          <textarea
            value={draft.copy}
            onChange={(e) => setDraft((d) => ({ ...d, copy: e.target.value }))}
            style={{ ...styles.input, minHeight: 80 }}
            required
            maxLength={500}
          />
        </label>
        <label style={styles.field}>
          <span style={styles.label}>Sample count (past events)</span>
          <input
            type="number"
            value={draft.sampleCount}
            min={1}
            max={20}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                sampleCount: Number(e.target.value) || 5,
              }))
            }
            style={styles.input}
          />
        </label>
        <label style={styles.fieldRow}>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={(e) =>
              setDraft((d) => ({ ...d, active: e.target.checked }))
            }
          />
          <span style={styles.label}>Active</span>
        </label>
        <div style={styles.actions}>
          {editingId ? (
            <button
              type="button"
              style={styles.btnSecondary}
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setEditingId(null);
              }}
            >
              Cancel edit
            </button>
          ) : null}
          <button type="submit" style={styles.btnPrimary} disabled={upsert.isPending}>
            {editingId ? "Save changes" : "Add rule"}
          </button>
        </div>
      </form>
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    padding: "24px",
    borderTop: "1px solid var(--rule)",
    marginTop: 24,
  },
  title: {
    fontSize: 16,
    letterSpacing: ".08em",
    textTransform: "uppercase",
    color: "var(--ink)",
    margin: "0 0 8px 0",
  },
  body: {
    fontSize: 13,
    color: "var(--muted)",
    margin: "0 0 16px 0",
    lineHeight: 1.5,
  },
  tableWrap: { overflowX: "auto", marginBottom: 24 },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontFamily: "var(--font-geist-mono), monospace",
    fontSize: 12,
  },
  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    color: "var(--muted)",
    borderBottom: "1px solid var(--rule)",
  },
  thActions: { width: 160, borderBottom: "1px solid var(--rule)" },
  td: {
    padding: "8px 12px",
    color: "var(--ink)",
    borderBottom: "1px solid var(--rule)",
  },
  empty: { padding: 16, color: "var(--faint)", fontSize: 13 },
  form: {
    display: "grid",
    gap: 12,
    padding: 16,
    border: "1px solid var(--rule)",
    backgroundColor: "var(--surface)",
  },
  formTitle: {
    fontSize: 13,
    color: "var(--ink)",
    margin: "0 0 8px 0",
  },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldRow: { display: "flex", gap: 8, alignItems: "center" },
  label: {
    fontSize: 11,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--muted)",
  },
  input: {
    padding: "8px 12px",
    border: "1px solid var(--rule)",
    background: "var(--bg)",
    color: "var(--ink)",
    fontSize: 13,
  },
  actions: { display: "flex", gap: 12, justifyContent: "flex-end" },
  btnPrimary: {
    padding: "8px 16px",
    background: "var(--accent)",
    color: "var(--bg)",
    border: "none",
    fontSize: 13,
    cursor: "pointer",
  },
  btnSecondary: {
    padding: "8px 12px",
    background: "transparent",
    color: "var(--muted)",
    border: "1px solid var(--rule)",
    fontSize: 12,
    cursor: "pointer",
    marginRight: 8,
  },
  btnDanger: {
    padding: "8px 12px",
    background: "transparent",
    color: "#E63946",
    border: "1px solid #E63946",
    fontSize: 12,
    cursor: "pointer",
  },
  err: { fontSize: 11, color: "#E63946" },
};
