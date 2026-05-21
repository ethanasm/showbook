import { db } from '@showbook/db';
import { announcements } from '@showbook/db';
import { and, eq, sql } from 'drizzle-orm';
import type { EventRun } from './run-grouping';

type AnnouncementRow = typeof announcements.$inferSelect;

/**
 * Find the row a run should extend, if any. Match on
 * (venueId, productionName, kind). Festival runs may also adopt an
 * existing concert row for the same production/venue — the row was
 * created before festival inference was strong enough to label it
 * correctly, and merging into it is preferable to creating a parallel
 * duplicate.
 */
export async function findExistingRunRow(
  run: EventRun,
): Promise<AnnouncementRow | undefined> {
  const [existing] = await db
    .select()
    .from(announcements)
    .where(
      and(
        eq(announcements.venueId, run.venueId),
        run.kind === 'festival'
          ? sql`${announcements.kind} in ('festival', 'concert')`
          : eq(announcements.kind, run.kind),
        eq(announcements.productionName, run.productionName),
      ),
    )
    .limit(1);
  return existing;
}

/**
 * Merge the new run's dates into an existing announcement row. Mutates
 * `existingSourceIds` so subsequent inserts in the same ingest pass
 * stay deduplicated.
 *
 * Returns 1 if any new dates were appended (the announcement was
 * meaningfully extended), 0 if the existing row already covered every
 * date.
 */
export async function extendExistingRun(
  existing: AnnouncementRow,
  run: EventRun,
  newSourceIds: string[],
  existingSourceIds: Set<string>,
): Promise<number> {
  const existingDates = new Set(existing.performanceDates ?? []);
  let extended = false;
  for (const d of run.performanceDates) {
    if (!existingDates.has(d)) {
      existingDates.add(d);
      extended = true;
    }
  }
  const merged = Array.from(existingDates).sort();
  const mergedExtras = Array.from(
    new Set([
      ...(existing.extraSourceEventIds ?? []),
      ...run.extraSourceEventIds,
    ]),
  );

  await db
    .update(announcements)
    .set({
      kind: run.kind,
      runStartDate: merged[0]!,
      runEndDate: merged[merged.length - 1]!,
      performanceDates: merged,
      showDate: merged[0]!,
      support: run.support ?? existing.support,
      supportPerformerIds: run.supportPerformerIds ?? existing.supportPerformerIds,
      onSaleDate:
        run.kind === 'festival'
          ? run.onSaleDate
          : run.onSaleDate ?? existing.onSaleDate,
      onSaleStatus: run.onSaleStatus,
      ticketUrl: run.ticketUrl ?? existing.ticketUrl,
      extraSourceEventIds: mergedExtras.length > 0 ? mergedExtras : null,
    })
    .where(eq(announcements.id, existing.id));

  for (const id of newSourceIds) existingSourceIds.add(id);
  for (const id of run.extraSourceEventIds) existingSourceIds.add(id);
  return extended ? 1 : 0;
}

/**
 * Insert a fresh announcement row for a run. `sourceEventId` is
 * per-night, not per-run; the column stays null on a run row and the
 * per-night IDs live in `performanceDates`' association via
 * `existingSourceIds` dedup state.
 */
export async function insertNewRunAnnouncement(
  run: EventRun,
  newSourceIds: string[],
  existingSourceIds: Set<string>,
): Promise<void> {
  await db.insert(announcements).values({
    venueId: run.venueId,
    kind: run.kind,
    headliner: run.headliner,
    headlinerPerformerId: run.headlinerPerformerId,
    support: run.support,
    supportPerformerIds: run.supportPerformerIds,
    productionName: run.productionName,
    showDate: run.runStartDate,
    runStartDate: run.runStartDate,
    runEndDate: run.runEndDate,
    performanceDates: run.performanceDates,
    onSaleDate: run.onSaleDate,
    onSaleStatus: run.onSaleStatus,
    source: run.source,
    sourceEventId: null,
    extraSourceEventIds:
      run.extraSourceEventIds.length > 0 ? run.extraSourceEventIds : null,
    ticketUrl: run.ticketUrl,
  });
  for (const id of newSourceIds) existingSourceIds.add(id);
  for (const id of run.extraSourceEventIds) existingSourceIds.add(id);
}
