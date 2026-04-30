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
  });

  if (!res.ok) {
    const errorText = await res.text();
    log.error({ event: 'places.autocomplete.error', status: res.status, body: errorText.substring(0, 200) }, 'autocomplete error');
    return [];
  }

  const data = await res.json();
  const suggestions = data.suggestions ?? [];

  return suggestions
    .filter((s: any) => s.placePrediction)
    .map((s: any) => ({
      placeId: s.placePrediction.placeId,
      displayName: s.placePrediction.structuredFormat?.mainText?.text ?? s.placePrediction.text?.text ?? '',
      formattedAddress: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
    }));
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
    },
  );

  if (!res.ok) return null;

  const data = await res.json();

  const components = data.addressComponents ?? [];
  const find = (type: string): string | null => {
    const comp = components.find((c: any) => c.types?.includes(type));
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
    photoUrl: data.photos?.[0]?.name ?? null,
  };
}

export function getPlacePhotoMediaUrl(photoName: string, maxWidthPx = 1200): string | null {
  const API_KEY = getApiKey();
  if (!API_KEY || !photoName) return null;
  const normalized = photoName.replace(/^\/+/, '');
  return `${BASE_URL}/${normalized}/media?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(API_KEY)}`;
}
