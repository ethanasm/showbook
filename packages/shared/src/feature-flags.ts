/**
 * In-code feature flag registry. Flag state is set here and changed by PR.
 * No env vars; no remote config. Only medium/high risk features get a
 * flag — low-risk additive changes ship unflagged.
 *
 * Lifecycle: land as 'OFF' with the no-op branch matching current
 * behaviour; flip to 'ON' after dev/E2E validation; delete the flag and
 * its OFF branch in a cleanup PR after a clean week in Axiom.
 */
export const FeatureFlag = {
  GmailScanPdfAttachments: {
    description:
      "R1 — fall back to PDF attachment extraction when the email body extract is null or low-confidence.",
    state: 'ON',
  },
  GmailScanHeuristicGate: {
    description:
      "P1 — pre-LLM regex/keyword scorer that skips obvious junk before any Groq call.",
    state: 'ON',
  },
  GmailScanCrossScanDedup: {
    description:
      "P4 — skip messages whose gmailMessageId is already referenced by one of the user's saved shows.",
    state: 'ON',
  },
} as const satisfies Record<string, { description: string; state: 'ON' | 'OFF' }>;

export type FeatureFlagKey = keyof typeof FeatureFlag;

export function isFeatureOn(key: FeatureFlagKey): boolean {
  return FeatureFlag[key].state === 'ON';
}
