/**
 * Server-side re-exports of the `shows.setlists` JSONB normalizers.
 * The implementations live in `@showbook/shared` so client bundles can
 * use them without dragging server-only deps (pg-boss, drizzle)
 * through; this thin shim lets API procedures and tests import the
 * read-path helpers from `@showbook/api` alongside the other
 * server-only utilities.
 */

export {
  normalizePerformerSetlistsMap,
  resolveShowSetlistsMap,
} from '@showbook/shared';
