import { TRPCError } from '@trpc/server';
import {
  entityLimit,
  entityLimitExceededError,
  type EntityLimitKey,
} from '@showbook/shared';

/**
 * Enforce a per-user follow cap before inserting a new follow row.
 *
 * `existingTargetIds` is the set of ids the user already follows for this
 * entity type — the call site does one cheap `SELECT` (mirroring the
 * `preferences.addRegion` pattern) and passes the ids in. Re-following
 * something already in the set is an idempotent no-op and is always
 * allowed; following a NEW target while already at the cap throws a
 * `BAD_REQUEST` carrying the shared cap-exceeded message.
 *
 * This is a UI-backed guard, not a hard concurrency boundary: two
 * simultaneous follows could each pass the count check and land the user
 * one over the cap. That's acceptable — the cap is a product guardrail,
 * not a security invariant, and the unique (userId, targetId) constraint
 * still prevents duplicate rows.
 */
export function assertUnderFollowCap(
  entity: EntityLimitKey,
  existingTargetIds: readonly string[],
  targetId: string,
): void {
  if (existingTargetIds.includes(targetId)) return;
  if (existingTargetIds.length >= entityLimit(entity)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: entityLimitExceededError(entity),
    });
  }
}
