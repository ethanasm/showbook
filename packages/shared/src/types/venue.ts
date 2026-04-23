export interface Venue {
  id: string;
  name: string;
  neighborhood?: string | null;
  city: string;
  stateRegion?: string | null;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  ticketmasterVenueId?: string | null;
  googlePlaceId?: string | null;
  createdAt: Date;
}
