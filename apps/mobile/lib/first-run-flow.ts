/**
 * First-run step sequencing.
 *
 * The onboarding wizard is four screens — notifications, location,
 * region (home base), gmail (pull in past tickets) — but two of them are
 * redundant for a user who already has state on their account (e.g. they
 * set up a region or imported shows on the web first, then installed the
 * app). This module computes which steps to show and where each step
 * advances to, so the progress dots / "STEP n OF m" labels stay correct
 * and the navigation skips the dropped screens cleanly instead of
 * flashing them and redirecting.
 *
 * Pure + dependency-free so it unit-tests under tsx/node without pulling
 * in react-native or the tRPC client (the hook that feeds it the query
 * results lives in `useFirstRunFlow.ts`).
 *
 * Skip rules (apply on both phone and tablet):
 *   - hide `region` when the user already has at least one region
 *   - hide `gmail` (past-tickets) when the user already has shows
 * `notifications` and `location` are always shown, so a brand-new user
 * (no regions, no shows) sees the original four-step flow unchanged.
 */

export type FirstRunStepKey = 'notifications' | 'location' | 'region' | 'gmail';

export const FIRST_RUN_ROUTES = {
  notifications: '/(auth)/first-run/notifications',
  location: '/(auth)/first-run/location',
  region: '/(auth)/first-run/region',
  gmail: '/(auth)/first-run/gmail',
} as const satisfies Record<FirstRunStepKey, string>;

export type FirstRunRoute = (typeof FIRST_RUN_ROUTES)[FirstRunStepKey];

export interface FirstRunFlowInput {
  /** True once the user has at least one followed region. */
  hasRegions: boolean;
  /** True once the user has at least one show on their account. */
  hasShows: boolean;
}

/**
 * The ordered list of step keys to show given the user's existing state.
 * Always includes `notifications` and `location`; conditionally includes
 * `region` and `gmail`.
 */
export function computeFirstRunSteps({ hasRegions, hasShows }: FirstRunFlowInput): FirstRunStepKey[] {
  const steps: FirstRunStepKey[] = ['notifications', 'location'];
  if (!hasRegions) steps.push('region');
  if (!hasShows) steps.push('gmail');
  return steps;
}

export interface StepPosition {
  /** 1-based index of the step within the flow; 0 when not in the flow. */
  step: number;
  /** Total number of steps in the flow. */
  total: number;
  /** Route of the next step, or null when this is the last step (→ finish). */
  nextRoute: FirstRunRoute | null;
  /** Whether this step appears in the computed flow at all. */
  inFlow: boolean;
}

/**
 * Resolve a step's display position and the route it advances to. A null
 * `nextRoute` means the step is last (the caller should finish onboarding
 * rather than push another screen).
 */
export function stepPosition(steps: FirstRunStepKey[], key: FirstRunStepKey): StepPosition {
  const idx = steps.indexOf(key);
  const total = steps.length;
  if (idx === -1) {
    return { step: 0, total, nextRoute: null, inFlow: false };
  }
  const nextKey = steps[idx + 1];
  return {
    step: idx + 1,
    total,
    nextRoute: nextKey ? FIRST_RUN_ROUTES[nextKey] : null,
    inFlow: true,
  };
}
