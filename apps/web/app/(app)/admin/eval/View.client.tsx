"use client";

import { useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { SectionHead } from "@/components/PreferencesPrimitives";

interface CalibrationBin {
  lower: number;
  upper: number;
  predictions: number;
  meanProbability: number;
  empiricalRate: number;
  delta: number;
}

interface StyleSummary {
  style: string;
  predictions: number;
  brier: number;
  precisionTop10: number;
  recallActual: number;
  recallTop15: number;
  calibrationError: number;
}

function formatScore(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return n.toFixed(3);
}

function formatPct(n: number | null | undefined): string {
  if (typeof n !== "number" || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricValue}>{value}</div>
      {hint && <div style={styles.metricHint}>{hint}</div>}
    </div>
  );
}

interface ChartPoint {
  ranAt: Date;
  brier: number;
  p10: number;
}

function MiniChart({ points }: { points: ChartPoint[] }) {
  if (points.length === 0) {
    return <div style={styles.chartEmpty}>No runs yet</div>;
  }
  const width = 640;
  const height = 180;
  const pad = 24;
  const xs = points.map((p) => p.ranAt.getTime());
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const xRange = Math.max(1, maxX - minX);

  const brierPath = points
    .map((p, i) => {
      const x = pad + ((p.ranAt.getTime() - minX) / xRange) * (width - 2 * pad);
      const yClamped = Math.min(0.5, Math.max(0, p.brier));
      const y = pad + (1 - yClamped / 0.5) * (height - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const p10Path = points
    .map((p, i) => {
      const x = pad + ((p.ranAt.getTime() - minX) / xRange) * (width - 2 * pad);
      const yClamped = Math.min(1, Math.max(0, p.p10));
      const y = pad + (1 - yClamped) * (height - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", height: "auto", display: "block" }}
      aria-label="Brier and Precision@10 over time"
    >
      <line
        x1={pad}
        x2={width - pad}
        y1={height - pad}
        y2={height - pad}
        stroke="var(--rule)"
        strokeWidth={1}
      />
      <line
        x1={pad}
        x2={pad}
        y1={pad}
        y2={height - pad}
        stroke="var(--rule)"
        strokeWidth={1}
      />
      <path
        d={brierPath}
        stroke="var(--accent)"
        strokeWidth={1.5}
        fill="none"
      />
      <path
        d={p10Path}
        stroke="var(--ink)"
        strokeWidth={1.5}
        strokeDasharray="3 3"
        fill="none"
      />
      {points.map((p, i) => {
        const x = pad + ((p.ranAt.getTime() - minX) / xRange) * (width - 2 * pad);
        const yBrier =
          pad + (1 - Math.min(0.5, Math.max(0, p.brier)) / 0.5) * (height - 2 * pad);
        const yP10 = pad + (1 - Math.min(1, Math.max(0, p.p10))) * (height - 2 * pad);
        return (
          <g key={i}>
            <circle cx={x} cy={yBrier} r={2} fill="var(--accent)" />
            <circle cx={x} cy={yP10} r={2} fill="var(--ink)" />
          </g>
        );
      })}
    </svg>
  );
}

function CalibrationCurve({ bins }: { bins: CalibrationBin[] }) {
  if (bins.length === 0) return null;
  const width = 320;
  const height = 320;
  const pad = 32;

  // Diagonal reference (perfect calibration).
  const diag = `M ${pad} ${height - pad} L ${width - pad} ${pad}`;

  const points = bins.filter((b) => b.predictions > 0);
  const linePath = points
    .map((b, i) => {
      const x = pad + b.meanProbability * (width - 2 * pad);
      const y = pad + (1 - b.empiricalRate) * (height - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width: "100%", maxWidth: 320, height: "auto", display: "block" }}
      aria-label="Calibration curve — predicted probability vs. empirical hit rate"
    >
      <rect
        x={pad}
        y={pad}
        width={width - 2 * pad}
        height={height - 2 * pad}
        fill="none"
        stroke="var(--rule)"
      />
      <path d={diag} stroke="var(--faint)" strokeDasharray="3 3" />
      {points.length >= 2 && (
        <path d={linePath} stroke="var(--accent)" strokeWidth={1.5} fill="none" />
      )}
      {points.map((b, i) => {
        const x = pad + b.meanProbability * (width - 2 * pad);
        const y = pad + (1 - b.empiricalRate) * (height - 2 * pad);
        const r = Math.max(2, Math.min(8, Math.sqrt(b.predictions) * 1.2));
        return <circle key={i} cx={x} cy={y} r={r} fill="var(--accent)" opacity={0.7} />;
      })}
      <text x={pad} y={height - 6} fontSize={9} fill="var(--muted)">
        predicted →
      </text>
      <text x={4} y={pad + 4} fontSize={9} fill="var(--muted)">
        actual ↑
      </text>
    </svg>
  );
}

export default function EvalView() {
  const summary = trpc.eval.summary.useQuery({ days: 30 });
  const latest = trpc.eval.latest.useQuery();
  const recent = trpc.eval.recentShows.useQuery({ limit: 25 });
  const rerunMutation = trpc.eval.rerunShow.useMutation({
    onSuccess: () => {
      recent.refetch();
      latest.refetch();
    },
  });
  const [activeRow, setActiveRow] = useState<string | null>(null);

  const chartPoints = useMemo<ChartPoint[]>(() => {
    if (!summary.data) return [];
    return [...summary.data]
      .reverse()
      .map((r) => ({
        ranAt: new Date(r.ranAt),
        brier: r.brierScore,
        p10: r.precisionTop10,
      }));
  }, [summary.data]);

  const latestRun = latest.data;
  const styleRows: StyleSummary[] = useMemo(() => {
    if (!latestRun) return [];
    const raw = (latestRun.byStyle ?? []) as unknown as StyleSummary[];
    return raw;
  }, [latestRun]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div style={styles.headerLabel}>Settings · Admin</div>
        <h1 style={styles.pageTitle}>
          <Activity size={20} style={styles.titleIcon} />
          Setlist eval harness
        </h1>
        <div style={styles.headerSub}>
          Shadow-mode back-test of the §4c predicted-setlist algorithm. Phase
          4 records numbers; Phase 5 turns them into a release gate. Cron at
          03:00 ET; manual re-run available per show.
        </div>
      </div>

      <div style={styles.content}>
        <div style={styles.contentInner}>
          <SectionHead
            label="Latest run"
            sub={
              latestRun
                ? `Ran ${new Date(latestRun.ranAt).toLocaleString()} · window ${latestRun.windowDays}d`
                : "No runs recorded yet — wait for the 03:00 ET cron"
            }
          />
          <div style={styles.metricsRow}>
            <MetricCard
              label="Brier (mean)"
              value={formatScore(latestRun?.brierScore)}
              hint="lower is better"
            />
            <MetricCard
              label="Precision@10"
              value={formatPct(latestRun?.precisionTop10)}
              hint="stable-gate metric"
            />
            <MetricCard
              label="Recall@15"
              value={formatPct(latestRun?.recallTop15)}
              hint="rotating-gate (SI-14)"
            />
            <MetricCard
              label="Predictions"
              value={latestRun ? String(latestRun.predictions) : "—"}
              hint="songs scored"
            />
          </div>

          <SectionHead
            label="Trailing 30 days"
            sub="Brier (solid, left axis 0→0.5) vs. P@10 (dashed, right axis 0→1)"
          />
          <div style={styles.chartCard}>
            <MiniChart points={chartPoints} />
            <div style={styles.legendRow}>
              <span style={styles.legendItem}>
                <span style={{ ...styles.swatch, background: "var(--accent)" }} />
                Brier (0–0.5)
              </span>
              <span style={styles.legendItem}>
                <span
                  style={{
                    ...styles.swatch,
                    background: "var(--ink)",
                    backgroundImage:
                      "linear-gradient(90deg, var(--ink) 50%, transparent 50%)",
                    backgroundSize: "6px 100%",
                  }}
                />
                Precision@10 (0–1)
              </span>
            </div>
          </div>

          <SectionHead
            label="Calibration curve (latest)"
            sub="Each dot is one probability bin; dot size = bin count. Hugging the diagonal is well-calibrated."
          />
          <div style={styles.chartCard}>
            <CalibrationCurve
              bins={(latestRun?.calibrationCurve ?? []) as CalibrationBin[]}
            />
          </div>

          {styleRows.length > 0 && (
            <>
              <SectionHead
                label="Per-style breakdown"
                sub="Phase 1 ships stable only; rotating / theatrical / improvised come from Phase 5+."
              />
              <div style={styles.styleTable}>
                <div style={styles.styleHeaderRow}>
                  <span>Style</span>
                  <span>Brier</span>
                  <span>P@10</span>
                  <span>R@15</span>
                  <span>Cal. err.</span>
                  <span>Preds</span>
                </div>
                {styleRows.map((s) => (
                  <div key={s.style} style={styles.styleRow}>
                    <span style={styles.styleName}>{s.style}</span>
                    <span>{formatScore(s.brier)}</span>
                    <span>{formatPct(s.precisionTop10)}</span>
                    <span>{formatPct(s.recallTop15)}</span>
                    <span>{formatPct(s.calibrationError)}</span>
                    <span>{s.predictions}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <SectionHead
            label="Most recent show evaluations"
            sub="Per-(performer, date) back-test rows. Click a row to expand the predicted-vs-played comparison."
          />
          <div style={styles.recentTable}>
            <div style={styles.recentHeaderRow}>
              <span>Performer</span>
              <span>Date</span>
              <span>Brier</span>
              <span>P@10</span>
              <span>R@15</span>
              <span>Sample</span>
              <span />
            </div>
            {(recent.data ?? []).map((row) => {
              const open = activeRow === row.id;
              return (
                <div key={row.id} style={styles.recentRowOuter}>
                  <button
                    type="button"
                    style={styles.recentRow}
                    onClick={() => setActiveRow(open ? null : row.id)}
                  >
                    <span style={styles.styleName}>{row.performerName}</span>
                    <span>{row.performanceDate}</span>
                    <span>{formatScore(row.brier)}</span>
                    <span>{formatPct(row.precisionTop10)}</span>
                    <span>{formatPct(row.recallTop15 ?? 0)}</span>
                    <span>{row.sampleSize}</span>
                    <span style={styles.muted}>{open ? "▾" : "▸"}</span>
                  </button>
                  {open && (
                    <div style={styles.expandPanel}>
                      <div style={styles.expandHeader}>
                        <button
                          type="button"
                          disabled={rerunMutation.isPending}
                          style={
                            rerunMutation.isPending
                              ? styles.rerunButtonDisabled
                              : styles.rerunButton
                          }
                          onClick={() =>
                            row.tourSetlistId &&
                            rerunMutation.mutate({
                              tourSetlistId: row.tourSetlistId,
                            })
                          }
                        >
                          {rerunMutation.isPending ? "Re-running…" : "Re-run for show"}
                        </button>
                        {rerunMutation.error && (
                          <span style={styles.errorLine}>
                            {rerunMutation.error.message}
                          </span>
                        )}
                      </div>
                      <div style={styles.expandGrid}>
                        <div style={styles.expandCol}>
                          <div style={styles.expandColTitle}>
                            Predicted (top 15)
                          </div>
                          <ol style={styles.songList}>
                            {[...row.predicted]
                              .sort((a, b) => b.probability - a.probability)
                              .slice(0, 15)
                              .map((p, i) => (
                                <li
                                  key={`${p.title}-${i}`}
                                  style={p.hit ? styles.songHit : styles.songMiss}
                                >
                                  <span>{p.title}</span>
                                  <span style={styles.songProb}>
                                    {(p.probability * 100).toFixed(0)}%
                                  </span>
                                </li>
                              ))}
                          </ol>
                        </div>
                        <div style={styles.expandCol}>
                          <div style={styles.expandColTitle}>Actual</div>
                          <ol style={styles.songList}>
                            {row.actual.map((title, i) => (
                              <li key={`${title}-${i}`} style={styles.songNeutral}>
                                {title}
                              </li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {(recent.data ?? []).length === 0 && (
              <div style={styles.recentEmpty}>
                No per-show eval rows yet. Will populate after the next cron run.
              </div>
            )}
          </div>
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
    padding: "16px var(--page-pad-x)",
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
    maxWidth: 640,
    lineHeight: 1.5,
  },
  content: {
    flex: 1,
    overflow: "auto",
    padding: "28px var(--page-pad-x) 60px",
  },
  contentInner: {
    maxWidth: 880,
  },
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: 12,
    marginBottom: 28,
  },
  metricCard: {
    background: "var(--surface)",
    border: "1px solid var(--rule)",
    padding: "14px 16px",
  },
  metricLabel: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    letterSpacing: ".08em",
    textTransform: "uppercase",
  },
  metricValue: {
    fontFamily: "var(--font-display)",
    fontSize: 22,
    color: "var(--ink)",
    marginTop: 4,
    letterSpacing: "-0.02em",
  },
  metricHint: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10,
    color: "var(--faint)",
    marginTop: 2,
  },
  chartCard: {
    background: "var(--surface)",
    border: "1px solid var(--rule)",
    padding: "18px 16px",
    marginBottom: 28,
  },
  chartEmpty: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--faint)",
    padding: "40px 0",
    textAlign: "center",
  },
  legendRow: {
    display: "flex",
    gap: 20,
    marginTop: 12,
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--muted)",
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
  },
  swatch: {
    width: 14,
    height: 3,
    display: "inline-block",
  },
  styleTable: {
    marginBottom: 28,
    border: "1px solid var(--rule)",
  },
  styleHeaderRow: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 80px 80px 100px 80px",
    gap: 8,
    padding: "10px 14px",
    background: "var(--surface)",
    borderBottom: "1px solid var(--rule)",
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    letterSpacing: ".08em",
    textTransform: "uppercase",
  },
  styleRow: {
    display: "grid",
    gridTemplateColumns: "1fr 80px 80px 80px 100px 80px",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--rule)",
    fontFamily: "var(--font-geist-mono)",
    fontSize: 12,
    color: "var(--ink)",
  },
  styleName: {
    fontWeight: 500,
  },
  recentTable: {
    border: "1px solid var(--rule)",
  },
  recentHeaderRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 0.8fr 80px 80px 80px 70px 28px",
    gap: 8,
    padding: "10px 14px",
    background: "var(--surface)",
    borderBottom: "1px solid var(--rule)",
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    letterSpacing: ".08em",
    textTransform: "uppercase",
  },
  recentRowOuter: {
    borderBottom: "1px solid var(--rule)",
  },
  recentRow: {
    display: "grid",
    gridTemplateColumns: "1.4fr 0.8fr 80px 80px 80px 70px 28px",
    gap: 8,
    padding: "10px 14px",
    width: "100%",
    background: "transparent",
    border: "none",
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "var(--font-geist-mono)",
    fontSize: 12,
    color: "var(--ink)",
  },
  recentEmpty: {
    padding: "24px",
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "var(--faint)",
    textAlign: "center",
  },
  expandPanel: {
    padding: "14px 16px 20px",
    background: "var(--surface-deep, var(--surface))",
    borderTop: "1px dashed var(--rule)",
  },
  expandHeader: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  expandGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 24,
  },
  expandCol: {
    minWidth: 0,
  },
  expandColTitle: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 10.5,
    color: "var(--muted)",
    letterSpacing: ".08em",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  songList: {
    listStyle: "decimal",
    paddingLeft: 20,
    margin: 0,
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    lineHeight: 1.55,
  },
  songHit: {
    color: "var(--ink)",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
  },
  songMiss: {
    color: "var(--faint)",
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    textDecoration: "line-through",
  },
  songNeutral: {
    color: "var(--ink)",
  },
  songProb: {
    color: "var(--muted)",
  },
  rerunButton: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--accent)",
    background: "transparent",
    border: "1px solid var(--accent)",
    padding: "6px 12px",
    cursor: "pointer",
  },
  rerunButtonDisabled: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: ".06em",
    textTransform: "uppercase",
    color: "var(--faint)",
    background: "transparent",
    border: "1px solid var(--rule-strong)",
    padding: "6px 12px",
    cursor: "not-allowed",
  },
  errorLine: {
    fontFamily: "var(--font-geist-mono)",
    fontSize: 11,
    color: "#E63946",
  },
  muted: {
    color: "var(--muted)",
  },
};
