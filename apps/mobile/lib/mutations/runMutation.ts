/**
 * Optimistic mutation runner.
 *
 * Order:
 *   1. Snapshot whatever the optimistic step needs to roll back.
 *   2. Apply the optimistic patch (cache writes, badge updates, etc.).
 *   3. Persist a `pending_writes` row in the outbox.
 *   4. Fire the network call.
 *   5a. Success → drop the outbox row, run `reconcile` so the cache picks
 *       up the canonical server payload.
 *   5b. Failure → restore the snapshot, leave the outbox row in place
 *       with `attempts++` so a future sweep can retry it.
 *
 * Every dependency is injected so the runner is unit-testable without
 * React Native, expo-sqlite, or a live tRPC client.
 */

import type { Outbox, PendingMutation } from '../cache/outbox';

export interface MutationContext<TInput, TSnapshot, TResult> {
  mutation: PendingMutation;
  input: TInput;
  outbox: Outbox;
  call: (input: TInput) => Promise<TResult>;
  optimistic?: {
    /** Snapshot the cache so we can roll back if the call fails. */
    snapshot: () => TSnapshot;
    /** Apply the optimistic update. */
    apply: (input: TInput) => void;
    /** Restore the cache to the snapshot. Called on failure. */
    rollback: (snapshot: TSnapshot) => void;
  };
  /** Reconcile the cache with the server payload after success. */
  reconcile?: (result: TResult, input: TInput) => void;
  /** Stable id for the pending row — tests pass one in. */
  pendingId?: string;
}

export interface MutationResult<TResult> {
  result: TResult;
  pendingId: string;
}

export async function runOptimisticMutation<TInput, TSnapshot, TResult>(
  ctx: MutationContext<TInput, TSnapshot, TResult>,
): Promise<MutationResult<TResult>> {
  const snapshot = ctx.optimistic?.snapshot();
  ctx.optimistic?.apply(ctx.input);

  const pending = await ctx.outbox.enqueue({
    id: ctx.pendingId,
    mutation: ctx.mutation,
    payload: ctx.input,
  });

  try {
    const result = await ctx.call(ctx.input);
    await ctx.outbox.drop(pending.id);
    ctx.reconcile?.(result, ctx.input);
    return { result, pendingId: pending.id };
  } catch (err) {
    if (ctx.optimistic && snapshot !== undefined) {
      ctx.optimistic.rollback(snapshot as TSnapshot);
    }
    const message = err instanceof Error ? err.message : String(err);
    await ctx.outbox.recordFailure(pending.id, message);
    throw err;
  }
}
