export interface Performer {
  id: string;
  name: string;
  musicbrainzId?: string | null;
  ticketmasterAttractionId?: string | null;
  imageUrl?: string | null;
  createdAt: Date;
}
