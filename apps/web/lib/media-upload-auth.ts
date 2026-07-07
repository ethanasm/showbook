import type { MediaVariant } from "@showbook/db";

/**
 * Find the variant of a pending media asset whose R2 key equals `key`.
 *
 * `media.createUploadIntent` inserts a `pending` `media_assets` row (reserving
 * the global/user/per-show byte + count quotas) and only then hands the client
 * a presigned URL for each `variant.key`. So a matching variant is proof the
 * direct upload was authorised and accounted for — and its `bytes` is the
 * per-variant size the quota actually reserved, which the PUT must not exceed.
 *
 * Pure over the already-fetched rows so the authz/quota-boundary logic is unit
 * testable; the DB query (scoped to the user's pending rows) lives at the call
 * site. Returns the matched variant, or null when no pending variant owns the key.
 */
export function matchPendingVariant(
  variantMaps: Array<Record<string, MediaVariant> | null | undefined>,
  key: string,
): MediaVariant | null {
  for (const variants of variantMaps) {
    for (const variant of Object.values(variants ?? {})) {
      if (variant?.key === key) return variant;
    }
  }
  return null;
}
