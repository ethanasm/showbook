/**
 * Hook layer over `first-run-flow.ts`: reads the user's existing regions
 * and shows via tRPC, computes the live step sequence, and exposes a
 * `goNext` that either pushes the next first-run screen or finishes
 * onboarding when the current step is the last one in the (possibly
 * shortened) flow.
 *
 * The two queries are lightweight and cached (the warm-up walker fetches
 * `shows.list` post sign-in anyway), so by the time the user taps through
 * the welcome + notifications screens the data is resolved and the region
 * / gmail steps are dropped at the navigation decision — no flash. When
 * the queries are still pending or fail (e.g. offline first-run), both
 * flags default to false and the full four-step flow is shown, matching
 * the original behaviour.
 */

import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { trpc } from './trpc';
import { useAuth } from './auth';
import {
  computeFirstRunSteps,
  stepPosition,
  type FirstRunStepKey,
  type StepPosition,
} from './first-run-flow';

export interface FirstRunFlow {
  steps: FirstRunStepKey[];
  position: (key: FirstRunStepKey) => StepPosition;
  /** Advance from `key`: push the next screen, or finish if it's the last. */
  goNext: (key: FirstRunStepKey) => void;
  /** Mark first-run complete and route into the app. */
  finish: () => Promise<void>;
}

export function useFirstRunFlow(): FirstRunFlow {
  const router = useRouter();
  const { markFirstRunComplete } = useAuth();

  const prefsQuery = trpc.preferences.get.useQuery(undefined, {
    staleTime: 5 * 60_000,
    retry: false,
  });
  const showsQuery = trpc.shows.list.useQuery(
    {},
    { staleTime: 5 * 60_000, retry: false },
  );

  const hasRegions = (prefsQuery.data?.regions.length ?? 0) > 0;
  const hasShows = (showsQuery.data?.length ?? 0) > 0;
  const steps = computeFirstRunSteps({ hasRegions, hasShows });

  const finish = useCallback(async () => {
    await markFirstRunComplete();
    router.replace('/(tabs)');
  }, [markFirstRunComplete, router]);

  const goNext = useCallback(
    (key: FirstRunStepKey) => {
      const pos = stepPosition(steps, key);
      if (pos.nextRoute) {
        router.push(pos.nextRoute);
      } else {
        void finish();
      }
    },
    [steps, router, finish],
  );

  return {
    steps,
    position: (key) => stepPosition(steps, key),
    goNext,
    finish,
  };
}
