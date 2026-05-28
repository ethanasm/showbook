/**
 * expo-image-picker wrapper for the M4 upload flow.
 *
 * The pipeline only consumes a small subset of expo-image-picker's API:
 *  - multi-select (up to 12 per design) from the photo library
 *  - single-shot camera capture (`captureMediaFromCamera`) so users at a
 *    venue can snap-and-add without round-tripping to Photos.app
 *  - photo + video MIME-type whitelist (delegated to the server's allow list)
 *  - normalised `SelectedFile` shape so `uploadFile` doesn't have to know
 *    about the picker's asset format.
 *
 * Permission errors and cancellations bubble up as `null` so the caller
 * can decide whether to show a banner / route to settings.
 */

import * as ImagePicker from 'expo-image-picker';
import type { SelectedFile } from './types';

export const MAX_SELECTION = 12;

function inferMimeType(asset: ImagePicker.ImagePickerAsset): string {
  if (asset.mimeType) return asset.mimeType;
  // Fallback: derive from the file extension. The server's allow list
  // canonicalises to lowercase mimeType, so the suffix → mime mapping
  // here only needs to cover the common picker outputs.
  const uri = asset.uri.toLowerCase();
  if (asset.type === 'video') {
    if (uri.endsWith('.mp4') || uri.endsWith('.mov')) return 'video/mp4';
    return 'video/mp4';
  }
  if (uri.endsWith('.png')) return 'image/png';
  if (uri.endsWith('.heic') || uri.endsWith('.heif')) return 'image/heic';
  if (uri.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function toSelectedFile(asset: ImagePicker.ImagePickerAsset): SelectedFile | null {
  if (!asset.uri) return null;
  const mediaType = asset.type === 'video' ? 'video' : 'photo';
  // The picker reports `fileSize` for some assets and not others. Without
  // a known byte count the server can't validate the quota, so skip.
  if (typeof asset.fileSize !== 'number' || asset.fileSize <= 0) return null;
  return {
    uri: asset.uri,
    mediaType,
    mimeType: inferMimeType(asset),
    bytes: asset.fileSize,
    width: typeof asset.width === 'number' ? asset.width : undefined,
    height: typeof asset.height === 'number' ? asset.height : undefined,
    durationMs:
      typeof asset.duration === 'number' && asset.duration > 0
        ? Math.round(asset.duration)
        : undefined,
  };
}

export interface PickResult {
  files: SelectedFile[];
  cancelled: boolean;
  permissionDenied: boolean;
}

export async function pickMediaFromLibrary(): Promise<PickResult> {
  // No library-wide permission request: on Android 13+ the system photo
  // picker handles selection inside the OS and returns only the items
  // the user explicitly chose, so READ_MEDIA_* would be redundant.
  // expo-image-picker v15 routes launchImageLibraryAsync through the
  // system picker on Android 13+ and through the equivalent PHPicker on
  // iOS 14+. Both surfaces own the picker UI; the app never enumerates
  // the underlying library.
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: MAX_SELECTION,
    quality: 1,
    exif: false,
  });
  if (res.canceled) {
    return { files: [], cancelled: true, permissionDenied: false };
  }
  const files: SelectedFile[] = [];
  for (const asset of res.assets ?? []) {
    const f = toSelectedFile(asset);
    if (f) files.push(f);
    if (files.length >= MAX_SELECTION) break;
  }
  return { files, cancelled: false, permissionDenied: false };
}

export async function captureMediaFromCamera(): Promise<PickResult> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { files: [], cancelled: false, permissionDenied: true };
  }
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: ['images', 'videos'],
    quality: 1,
    exif: false,
  });
  if (res.canceled) {
    return { files: [], cancelled: true, permissionDenied: false };
  }
  const files: SelectedFile[] = [];
  for (const asset of res.assets ?? []) {
    const f = toSelectedFile(asset);
    if (f) files.push(f);
  }
  return { files, cancelled: false, permissionDenied: false };
}

export const __testing = { toSelectedFile, inferMimeType };
