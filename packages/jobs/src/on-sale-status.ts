/**
 * On-sale status helpers.
 *
 * The implementation now lives in `@showbook/api` (`ticketmaster.ts`)
 * because it operates purely on the `TMEvent` shape that package owns and
 * is shared with the live performer-upcoming lookup. This module re-exports
 * the canonical functions so existing `@showbook/jobs` importers (incl. the
 * discover-ingest pipeline and its unit tests) keep working unchanged.
 */

export {
  determineOnSaleStatus,
  parseOnSaleDate,
  type OnSaleStatus,
} from '@showbook/api';
