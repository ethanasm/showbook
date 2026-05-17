/**
 * Calibration release-gate for the predicted-setlist display variants.
 * Phase 5 — stable + rotating thresholds; Phase 6 extends to
 * theatrical + improvised. The back-test harness from Phase 4
 * (prediction_eval_runs) is the authoritative source for whether
 * each variant is allowed to render.
 *
 * Thresholds (verbatim from the phase specs):
 *
 *   Phase 5:
 *     - stable-style mean Brier ≤ 0.15
 *     - rotating-style recall-at-15 ≥ 0.55 (switched from
 *       precision-at-10 per SI-14)
 *     - no calibration bin with |delta| > 0.20
 *
 *   Phase 6:
 *     - theatrical-style mean Brier ≤ 0.15 (the deterministic part
 *       should be near-perfect; surprise slots contribute the error)
 *     - improvised-style show-mode top-prediction empirical hit-rate
 *       within 20pp of its predicted probability (no song-level
 *       gate — the improvised model doesn't emit song probabilities
 *       to score)
 *
 * Any breach blocks the matching display variant. Stable + rotating
 * gates aren't affected by P6's new metrics — each variant is gated
 * independently so a theatrical regression doesn't take down stable.
 *
 * The function is pure — callers fetch the latest run row from
 * `prediction_eval_runs` and feed it in. The setlist-intel router's
 * public `releaseGate` procedure wraps that lookup.
 */

export const RELEASE_GATE_THRESHOLDS = {
  stableBrierMax: 0.15,
  rotatingRecallTop15Min: 0.55,
  calibrationDeltaMax: 0.2,
  theatricalBrierMax: 0.15,
  improvisedShowModeDeltaMax: 0.2,
} as const;

export type ReleaseGateMetric =
  | 'stable_brier'
  | 'rotating_recall_top15'
  | 'calibration_delta'
  | 'theatrical_brier'
  | 'improvised_show_mode_calibration';

export interface ReleaseGateInput {
  byStyle: Array<{
    style: string;
    brier: number;
    recallTop15: number;
    predictions: number;
    /**
     * Phase 6 — improvised-style only. Empirical hit-rate of the
     * predicted top show-mode minus its predicted probability. A
     * 0.05 value means the model predicted 65% Regular and 70% of
     * actual shows in the window were Regular. Field is optional so
     * P4/P5 eval runs without the field don't crash the gate.
     */
    showModeCalibrationDelta?: number | null;
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
  metric: ReleaseGateMetric;
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
  /** Phase 6 — true when the run scored at least one theatrical
   *  prediction. The variant flips ON only once we have a sample. */
  theatricalEvaluable: boolean;
  /** Phase 6 — true when the run carried an improvised show-mode
   *  calibration delta. */
  improvisedEvaluable: boolean;
}

/**
 * Compute the gate verdict for a single eval run. Default semantics
 * are *conservative*: a missing rotating bucket flags the gate as
 * failed (no calibration data → not safe to flip the rotating UI on).
 * Theatrical + improvised follow the same pattern — without data the
 * matching display variant stays gated. Callers can opt into
 * "permissive when unevaluable" by inspecting the per-variant
 * `*Evaluable` flags.
 */
export function evaluateReleaseGate(input: ReleaseGateInput): ReleaseGateResult {
  const breaches: ReleaseGateBreach[] = [];

  const stable = input.byStyle.find((s) => s.style === 'stable');
  const rotating = input.byStyle.find((s) => s.style === 'rotating');
  const theatrical = input.byStyle.find((s) => s.style === 'theatrical');
  const improvised = input.byStyle.find((s) => s.style === 'improvised');

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

  // Phase 6 — theatrical gate uses the same Brier threshold as stable
  // because the deterministic portion of the prediction should land
  // near-perfect. Missing data → fail (conservative; the variant
  // stays gated until the harness has a sample).
  if (theatrical && theatrical.predictions > 0) {
    if (theatrical.brier > RELEASE_GATE_THRESHOLDS.theatricalBrierMax) {
      breaches.push({
        metric: 'theatrical_brier',
        value: theatrical.brier,
        threshold: RELEASE_GATE_THRESHOLDS.theatricalBrierMax,
        style: 'theatrical',
      });
    }
  } else {
    breaches.push({
      metric: 'theatrical_brier',
      value: 0,
      threshold: RELEASE_GATE_THRESHOLDS.theatricalBrierMax,
      style: 'theatrical',
    });
  }

  // Phase 6 — improvised gate bypasses the song-level Brier (the
  // improvised model emits no song probabilities). The check is
  // instead on the predicted top show-mode probability vs. its
  // empirical hit-rate over the trailing window.
  if (
    improvised &&
    improvised.predictions > 0 &&
    typeof improvised.showModeCalibrationDelta === 'number'
  ) {
    if (
      Math.abs(improvised.showModeCalibrationDelta) >
      RELEASE_GATE_THRESHOLDS.improvisedShowModeDeltaMax
    ) {
      breaches.push({
        metric: 'improvised_show_mode_calibration',
        value: improvised.showModeCalibrationDelta,
        threshold: RELEASE_GATE_THRESHOLDS.improvisedShowModeDeltaMax,
        style: 'improvised',
      });
    }
  } else {
    breaches.push({
      metric: 'improvised_show_mode_calibration',
      value: 0,
      threshold: RELEASE_GATE_THRESHOLDS.improvisedShowModeDeltaMax,
      style: 'improvised',
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
    theatricalEvaluable: Boolean(theatrical && theatrical.predictions > 0),
    improvisedEvaluable: Boolean(
      improvised &&
        improvised.predictions > 0 &&
        typeof improvised.showModeCalibrationDelta === 'number',
    ),
  };
}
