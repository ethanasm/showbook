import type { Venue } from './venue';

export interface Announcement {
  id: string;
  venueId: string;
  kind: 'concert' | 'theatre' | 'comedy' | 'festival';
  headliner: string;
  headlinerPerformerId?: string | null;
  support?: string[] | null;
  showDate: string;
  onSaleDate?: Date | null;
  onSaleStatus: 'announced' | 'on_sale' | 'sold_out';
  source: 'ticketmaster' | 'manual';
  sourceEventId?: string | null;
  discoveredAt: Date;
}

export interface AnnouncementWithVenue extends Announcement {
  venue: Venue;
}
