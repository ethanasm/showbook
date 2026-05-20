/**
 * Pure dedup helpers. Mirror the web app's `isDuplicate` check in
 * `apps/web/components/shows-list/ShowsListView.tsx`: a ticket is a
 * duplicate when an existing show has the same headliner (case-
 * insensitive) AND the same date.
 */

import type { GmailTicket } from './types';

export interface DedupShow {
  date: string | null;
  showPerformers: readonly {
    role: string;
    performer: { name: string };
  }[];
}

export function isDuplicateTicket(
  ticket: Pick<GmailTicket, 'headliner' | 'date'>,
  existingShows: readonly DedupShow[],
): boolean {
  const headliner = ticket.headliner.toLowerCase();
  return existingShows.some((show) => {
    if (ticket.date == null || show.date !== ticket.date) return false;
    return show.showPerformers.some(
      (sp) => sp.role === 'headliner' && sp.performer.name.toLowerCase() === headliner,
    );
  });
}
