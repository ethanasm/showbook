import type { ShowKind } from "@/components/design-system";

export type Mode = "Form" | "Chat";
export type Timeframe = "past" | "upcoming" | "watching";

export interface VenueData {
  name: string;
  city: string;
  stateRegion?: string;
  country?: string;
  tmVenueId?: string;
  googlePlaceId?: string;
  photoUrl?: string;
  lat?: number;
  lng?: number;
}

export interface HeadlinerData {
  name: string;
  tmAttractionId?: string;
  musicbrainzId?: string;
  imageUrl?: string;
}

export interface PerformerData {
  name: string;
  role: "headliner" | "support" | "cast";
  characterName?: string;
  sortOrder: number;
  tmAttractionId?: string;
  musicbrainzId?: string;
  imageUrl?: string;
}

export interface TMResult {
  tmEventId: string;
  name: string;
  date: string;
  venueName: string | null;
  venueCity: string | null;
  venueState: string | null;
  venueCountry: string | null;
  venueTmId: string | null;
  venueLat: number | null;
  venueLng: number | null;
  kind: string | null;
  performers: {
    name: string;
    tmAttractionId: string;
    imageUrl: string | null;
  }[];
}

export interface CastMember {
  actor: string;
  role: string;
}

export interface GmailResult {
  headliner: string;
  production_name: string | null;
  venue_name: string | null;
  venue_city: string | null;
  venue_state: string | null;
  date: string | null;
  seat: string | null;
  price: string | null;
  ticket_count: number | null;
  kind_hint: "concert" | "theatre" | "comedy" | "festival" | null;
  confidence: "high" | "medium" | "low";
}

export interface ChatParsedResult {
  // Nullable because parseChat can resolve a date / kind without a
  // name (conversational follow-ups, "I saw something on 2018-08-05",
  // etc). The confirm-save path guards against an empty headliner
  // and surfaces an assistant message instead of letting the server
  // reject with a 400.
  headliner: string | null;
  venue_hint: string | null;
  date_hint: string | null;
  seat_hint: string | null;
  kind_hint: ShowKind | null;
}
