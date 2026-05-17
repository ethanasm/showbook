import { z } from 'zod';
import { child } from '@showbook/observability';

const log = child({ component: 'api.google-places' });

const BASE_URL = 'https://places.googleapis.com/v1';

function getApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY ?? '';
}

export interface PlaceSuggestion {
  placeId: string;
  displayName: string;
  formattedAddress: string;
}

export interface PlaceDetails {
  name: string;
  city: string;
  stateRegion: string | null;
  country: string;
  latitude: number;
  longitude: number;
  googlePlaceId: string;
  photoUrl: string | null;
}

// Google Places API (New) response shapes. Only the fields actually consumed
// are typed; everything else is permitted via passthrough so an additive
// upstream change doesn't blow up our parse.
const AutocompleteResponseSchema = z
  .object({
    suggestions: z
      .array(
        z
          .object({
            placePrediction: z
              .object({
                placeId: z.string(),
                text: z.object({ text: z.string() }).partial().optional(),
                structuredFormat: z
                  .object({
                    mainText: z.object({ text: z.string() }).partial().optional(),
                    secondaryText: z.object({ text: z.string() }).partial().optional(),
                  })
                  .partial()
                  .optional(),
              })
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

const AddressComponentSchema = z
  .object({
    types: z.array(z.string()).optional(),
    longText: z.string().optional(),
    shortText: z.string().optional(),
  })
  .passthrough();

const PhotoSchema = z
  .object({
    name: z.string().optional(),
    widthPx: z.number().optional(),
    heightPx: z.number().optional(),
  })
  .passthrough();

const PlaceDetailsResponseSchema = z
  .object({
    displayName: z.object({ text: z.string() }).partial().optional(),
    formattedAddress: z.string().optional(),
    location: z
      .object({ latitude: z.number(), longitude: z.number() })
      .partial()
      .optional(),
    addressComponents: z.array(AddressComponentSchema).optional(),
    photos: z.array(PhotoSchema).optional(),
  })
  .passthrough();

export async function autocomplete(
  input: string,
  types: string[] = ['establishment'],
): Promise<PlaceSuggestion[]> {
  const API_KEY = getApiKey();
  if (!API_KEY || input.length < 2) return [];

  const res = await fetch(`${BASE_URL}/places:autocomplete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
    },
    body: JSON.stringify({
      input,
      includedPrimaryTypes: types,
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const errorText = await res.text();
    log.error({ event: 'places.autocomplete.error', status: res.status, body: errorText.substring(0, 200) }, 'autocomplete error');
    return [];
  }

  const raw = await res.json();
  const parsed = AutocompleteResponseSchema.safeParse(raw);
  if (!parsed.success) {
    log.error(
      { event: 'places.autocomplete.parse_failed', issues: parsed.error.issues.slice(0, 5) },
      'autocomplete response did not match expected shape',
    );
    return [];
  }

  const suggestions = parsed.data.suggestions ?? [];

  return suggestions.flatMap((s) => {
    const p = s.placePrediction;
    if (!p) return [];
    return [
      {
        placeId: p.placeId,
        displayName:
          p.structuredFormat?.mainText?.text ?? p.text?.text ?? '',
        formattedAddress: p.structuredFormat?.secondaryText?.text ?? '',
      },
    ];
  });
}

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
  const API_KEY = getApiKey();
  if (!API_KEY) return null;

  const fieldMask = 'displayName,formattedAddress,location,addressComponents,photos';
  const res = await fetch(
    `${BASE_URL}/places/${placeId}?languageCode=en`,
    {
      headers: {
        'X-Goog-Api-Key': API_KEY,
        'X-Goog-FieldMask': fieldMask,
      },
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!res.ok) return null;

  const raw = await res.json();
  const parsed = PlaceDetailsResponseSchema.safeParse(raw);
  if (!parsed.success) {
    log.error(
      { event: 'places.details.parse_failed', placeId, issues: parsed.error.issues.slice(0, 5) },
      'place details response did not match expected shape',
    );
    return null;
  }
  const data = parsed.data;

  const components = data.addressComponents ?? [];
  const find = (type: string): string | null => {
    const comp = components.find((c) => c.types?.includes(type));
    return comp?.longText ?? comp?.shortText ?? null;
  };

  return {
    name: data.displayName?.text ?? '',
    city: find('locality') ?? find('administrative_area_level_2') ?? '',
    stateRegion: find('administrative_area_level_1'),
    country: find('country') ?? 'US',
    latitude: data.location?.latitude ?? 0,
    longitude: data.location?.longitude ?? 0,
    googlePlaceId: placeId,
    photoUrl: pickBestPhotoName(data.photos),
  };
}

// Iterate the top 5 Places photos and pick the first that looks like a hero:
// landscape (ratio >= 1.3) and large enough (width >= 1600px). Google's
// top-ranked photo is usually fine, but for ~20% of venues it's a portrait
// food shot or a tight marquee close-up — this picks the next viable
// landscape instead. Falls back to photos[0] when nothing matches so we
// never regress to "no photo at all".
//
// Accepts `unknown` so callers parsing arbitrary JSON can hand the
// `photos` field directly; the guards below cope with any shape.
export function pickBestPhotoName(photos: unknown): string | null {
  if (!Array.isArray(photos) || photos.length === 0) return null;
  const MIN_RATIO = 1.3;
  const MIN_WIDTH = 1600;
  const candidates = photos.slice(0, 5);
  for (const photo of candidates) {
    const name = (photo as { name?: unknown })?.name;
    const w = Number((photo as { widthPx?: unknown })?.widthPx);
    const h = Number((photo as { heightPx?: unknown })?.heightPx);
    if (typeof name !== 'string' || !name || !Number.isFinite(w) || !Number.isFinite(h) || h <= 0) continue;
    if (w / h >= MIN_RATIO && w >= MIN_WIDTH) return name;
  }
  const first = photos[0] as { name?: unknown } | undefined;
  return typeof first?.name === 'string' ? first.name : null;
}

export function getPlacePhotoMediaUrl(photoName: string, maxWidthPx = 1200): string | null {
  const API_KEY = getApiKey();
  if (!API_KEY || !photoName) return null;
  const normalized = photoName.replace(/^\/+/, '');
  return `${BASE_URL}/${normalized}/media?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(API_KEY)}`;
}
