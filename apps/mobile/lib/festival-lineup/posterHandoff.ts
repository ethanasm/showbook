/**
 * One-shot handoff for the festival poster image picked inside the
 * "Upload a festival poster" sheet on the Add tab.
 *
 * The picker runs in the sheet so the user picks before navigation,
 * but the base64 payload is too big to round-trip through Expo Router
 * params. Module-level pointer + consume-on-read keeps the path
 * boringly synchronous and survives the sheet → route push.
 */

import type { PickedFestivalImage } from './pickFestivalImage';

let pending: PickedFestivalImage | null = null;

export function setPendingFestivalPoster(image: PickedFestivalImage | null): void {
  pending = image;
}

export function consumePendingFestivalPoster(): PickedFestivalImage | null {
  const out = pending;
  pending = null;
  return out;
}
