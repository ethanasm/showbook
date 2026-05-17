/**
 * Calibration release-gate for the rotating-style display variant.
 * Phase 5 exit-criterion #5 — the back-test harness from Phase 4
 * (prediction_eval_runs) is now the authoritative source for whether
 * the rotating UI is allowed to render.
 *
 * Thresholds (verbatim from
 * showbook-specs/setlist-intelligence/phases/phase-05-style-classifier-rotating.md):
 *
 *   - stable-style mean Brier ≤ 0.15
 *   - rotating-style recall-at-15 ≥ 0.55 (switched from precision-at-10
 *     per SI-14)
 *   - no calibration bin with |delta| > 0.20
 *
 * Any breach blocks the rotating display. The stable-style tab system
 * is *not* gated by this — only the new rotating exposure.
 *
 * The function is pure — caller fetches the latest run row from
 * `prediction_eval_runs` and feeds it in. The setlist-intel router's
 * public `releaseGate` procedure wraps that lookup.
 */

export const RELEASE_GATE_THRESHOLDS = {
  stableBrierMax: 0.15,
  rotatingRecallTop15Min: 0.55,
  calibrationDeltaMax: 0.2,
} as const;

export interface ReleaseGateInput {
  byStyle: Array<{
    style: string;
    brier: number;
    recallTop15: number;
    predictions: number;
  }>;
  calibrationCurve: Array<{
    lower: number;
    upper: number;
    predictions: number;
    meanProbability: number;
    empiricalRate: number;
    delta: number;
  }>;
}

export interface ReleaseGateBreach {
  metric: 'stable_brier' | 'rotating_recall_top15' | 'calibration_delta';
  value: number;
  threshold: number;
  /** Optional bin identifier for calibration breaches. */
  binLower?: number;
  binUpper?: number;
  /** Optional style label when the metric is style-scoped. */
  style?: string;
}

export interface ReleaseGateResult {
  passes: boolean;
  reasons: ReleaseGateBreach[];
  /** True when the run had no rotating-style predictions to evaluate;
   *  the rotating gate metric is then unenforceable rather than failed. */
  rotatingEvaluable: boolean;
  /** True when the run had no stable-style predictions. */
  stableEvaluable: boolean;
}

/**
 * Compute the gate verdict for a single eval run. Default semantics
 * are *conservative*: a missing rotating bucket flags the gate as
 * failed (no calibration data → not safe to flip the rotating UI on).
 * Callers can opt into "permissive when unevaluable" by inspecting
 * `result.rotatingEvaluable`.
 */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const breaches: ReleaseGateBreach[] = [];

  const stable = input.byStyle.find((s) => s.style === 'stable');
  const rotating = input.byStyle.find((s) => s.style === 'rotating');

  if (stable && stable.predictions > 0) {
    if (stable.brier > RELEASE_GATE_THRESHOLDS.stableBrierMax) {
      breaches.push({
        metric: 'stable_brier',
        value: stable.brier,
        threshold: RELEASE_GATE_THRESHOLDS.stableBrierMax,
        style: 'stable',
      });
    }
  }

  if (rotating && rotating.predictions > 0) {
    if (
      rotating.recallTop15 < RELEASE_GATE_THRESHOLDS.rotatingRecallTop15Min
    ) {
      breaches.push({
        metric: 'rotating_recall_top15',
        value: rotating.recallTop15,
        threshold: RELEASE_GATE_THRESHOLDS.rotatingRecallTop15Min,
        style: 'rotating',
      });
    }
  } else {
    // Missing rotating bucket → the gate cannot pass for rotating display
    // until we have data.
    breaches.push({
      metric: 'rotating_recall_top15',
      value: 0,
      threshold: RELEASE_GATE_THRESHOLDS.rotatingRecallTop15Min,
      style: 'rotating',
    });
  }

  for (const bin of input.calibrationCurve ?? []) {
    if (bin.predictions === 0) continue;
    if (Math.abs(bin.delta) > RELEASE_GATE_THRESHOLDS.calibrationDeltaMax) {
      breaches.push({
        metric: 'calibration_delta',
        value: bin.delta,
        threshold: RELEASE_GATE_THRESHOLDS.calibrationDeltaMax,
        binLower: bin.lower,
        binUpper: bin.upper,
      });
    }
  }

  return {
    passes: breaches.length === 0,
    reasons: breaches,
    rotatingEvaluable: Boolean(rotating && rotating.predictions > 0),
    stableEvaluable: Boolean(stable && stable.predictions > 0),
  };
}
