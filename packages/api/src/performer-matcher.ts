import { db, performers } from '@showbook/db';
import { eq, sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerformerInput {
  name: string;
  tmAttractionId?: string;
  setlistfmMbid?: string;
  imageUrl?: string;
}

export interface PerformerMatchResult {
  performer: typeof performers.$inferSelect;
  created: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a partial update object for fields the matched performer is missing
 * but the input provides.
 */
function buildUpdate(
  existing: typeof performers.$inferSelect,
  input: PerformerInput,
): Partial<Record<'imageUrl' | 'setlistfmMbid' | 'ticketmasterAttractionId', string>> | null {
  const updates: Record<string, string> = {};

  if (!existing.imageUrl && input.imageUrl) {
    updates.imageUrl = input.imageUrl;
  }
  if (!existing.setlistfmMbid && input.setlistfmMbid) {
    updates.setlistfmMbid = input.setlistfmMbid;
  }
  if (!existing.ticketmasterAttractionId && input.tmAttractionId) {
    updates.ticketmasterAttractionId = input.tmAttractionId;
  }

  return Object.keys(updates).length > 0 ? updates : null;
}

/**
 * Apply pending updates to a matched performer and return the refreshed row.
 */
async function applyUpdates(
  existing: typeof performers.$inferSelect,
  input: PerformerInput,
): Promise<typeof performers.$inferSelect> {
  const updates = buildUpdate(existing, input);
  if (!updates) return existing;

  const [updated] = await db
    .update(performers)
    .set(updates)
    .where(eq(performers.id, existing.id))
    .returning();

  return updated;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function matchOrCreatePerformer(
  input: PerformerInput,
): Promise<PerformerMatchResult> {
  // 1. TM attraction ID match
  if (input.tmAttractionId) {
    const [match] = await db
      .select()
      .from(performers)
      .where(eq(performers.ticketmasterAttractionId, input.tmAttractionId))
      .limit(1);

    if (match) {
      return { performer: await applyUpdates(match, input), created: false };
    }
  }

  // 2. setlist.fm MBID match
  if (input.setlistfmMbid) {
    const [match] = await db
      .select()
      .from(performers)
      .where(eq(performers.setlistfmMbid, input.setlistfmMbid))
      .limit(1);

    if (match) {
      return { performer: await applyUpdates(match, input), created: false };
    }
  }

  // 3. Case-insensitive name match
  const [nameMatch] = await db
    .select()
    .from(performers)
    .where(sql`lower(${performers.name}) = lower(${input.name})`)
    .limit(1);

  if (nameMatch) {
    return { performer: await applyUpdates(nameMatch, input), created: false };
  }

  // 4. Create new performer
  const [created] = await db
    .insert(performers)
    .values({
      name: input.name,
      ticketmasterAttractionId: input.tmAttractionId ?? null,
      setlistfmMbid: input.setlistfmMbid ?? null,
      imageUrl: input.imageUrl ?? null,
    })
    .returning();

  return { performer: created, created: true };
}
