export interface Performer {
  id: string;
  name: string;
  setlistfmMbid?: string | null;
  ticketmasterAttractionId?: string | null;
  imageUrl?: string | null;
  createdAt: Date;
}
