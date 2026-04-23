import type { Venue } from './venue';
import type { Performer } from './performer';

export interface Show {
  id: string;
  userId: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  state: 'past' | 'ticketed' | 'watching';
  venueId: string;
  date: string;
  endDate?: string | null;
  seat?: string | null;
  pricePaid?: string | null;
  tourName?: string | null;
  setlist?: string[] | null;
  photos?: string[] | null;
  sourceRefs?: Record<string, string> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShowWithRelations extends Show {
  venue: Venue;
  performers: ShowPerformer[];
}

export interface ShowPerformer {
  performerId: string;
  role: 'headliner' | 'support' | 'cast';
  characterName?: string | null;
  sortOrder: number;
  performer: Performer;
}
