/**
 * pickFestivalImage — single-image picker for the festival-poster flow.
 * Returns the asset as base64 so the caller can pass it straight to
 * `trpc.enrichment.extractFestivalLineup`.
 *
 * PDF posters aren't pickable from the iOS / Android photo library; users
 * with a PDF schedule would need a separate document picker — deferred
 * until we add `expo-document-picker` as a dep. Images alone cover the
 * majority of festival lineup posters.
 */

import * as ImagePicker from 'expo-image-picker';

export interface PickedFestivalImage {
  base64: string;
  mimeType: string;
  uri: string;
}

export interface PickFestivalImageResult {
  image: PickedFestivalImage | null;
  cancelled: boolean;
  permissionDenied: boolean;
}

export async function pickFestivalImage(): Promise<PickFestivalImageResult> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { image: null, cancelled: false, permissionDenied: true };
  }

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: false,
    quality: 0.85,
    base64: true,
    exif: false,
  });

  if (res.canceled) {
    return { image: null, cancelled: true, permissionDenied: false };
  }

  const asset = res.assets?.[0];
  if (!asset || !asset.base64) {
    return { image: null, cancelled: true, permissionDenied: false };
  }

  return {
    image: {
      base64: asset.base64,
      mimeType: asset.mimeType ?? 'image/jpeg',
      uri: asset.uri,
    },
    cancelled: false,
    permissionDenied: false,
  };
}
