/**
 * Pure mapper from the `enrichment.extractCast` LLM result to mobile
 * lineup rows. Mirrors the web Add flow's playbill handler
 * (`useAddShowForm.handlePlaybillUpload`): each extracted
 * `{ actor, role }` becomes a cast `PerformerRow` with the character in
 * `characterName`. Pure so it's unit-testable without the picker / tRPC
 * (the mobile coverage gate is scoped to `lib/**`).
 */

import type { PerformerRow } from '@/lib/showForm';

export interface ExtractedCastMember {
  actor: string;
  role: string;
}

export function castToPerformerRows(
  cast: readonly ExtractedCastMember[],
  newRowId: () => string,
): PerformerRow[] {
  const rows: PerformerRow[] = [];
  const seen = new Set<string>();
  for (const c of cast) {
    const name = (c?.actor ?? '').trim();
    if (name.length === 0) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const character = (c?.role ?? '').trim();
    rows.push({
      id: newRowId(),
      name,
      ...(character.length > 0 ? { characterName: character } : {}),
    });
  }
  return rows;
}

/**
 * Merge freshly-extracted cast rows into the existing lineup: drop any
 * blank in-progress rows the user hasn't filled, then append only the
 * extracted names not already present (case-insensitive).
 */
export function mergeCastRows(
  existing: readonly PerformerRow[],
  extracted: readonly PerformerRow[],
): PerformerRow[] {
  const kept = existing.filter((r) => r.name.trim().length > 0);
  const present = new Set(kept.map((r) => r.name.trim().toLowerCase()));
  const additions = extracted.filter(
    (r) => !present.has(r.name.trim().toLowerCase()),
  );
  return [...kept, ...additions];
}
