import type { TMEvent } from '@showbook/api';

export type OnSaleStatus =
  | 'announced'
  | 'presale'
  | 'on_sale'
  | 'sold_out'
  | 'cancelled';

// TM Discovery API uses American spelling 'canceled'; accept both defensively.
function isCanceled(event: TMEvent): boolean {
  const code = event.dates?.status?.code;
  return code === 'canceled' || code === 'cancelled';
}

// TM emits dates.status.code='offsale' during the presale-only period
// because the *public* sale isn't open; trusting that verbatim used to
// mark presales as sold out — exactly the contradiction surfaced by
// "SOLD OUT — On sale MAY 20". Only treat 'offsale' as sold_out *after*
// the presale-window check has had a chance to claim the event.
function isExplicitlyOffSale(event: TMEvent): boolean {
  return event.dates?.status?.code === 'offsale';
}

function isCurrentlyInPresale(event: TMEvent, now: Date): boolean {
  return (
    event.sales?.presales?.some((p) => {
      const start = p.startDateTime ? new Date(p.startDateTime) : null;
      const end = p.endDateTime ? new Date(p.endDateTime) : null;
      const startedOrUnknown = !start || start <= now;
      const notYetEnded = !end || end > now;
      return startedOrUnknown && notYetEnded;
    }) ?? false
  );
}

export function determineOnSaleStatus(event: TMEvent): OnSaleStatus {
  // A cancelled event is a distinct outcome from "sold out" — the show
  // isn't happening at all. TM surfaces this as dates.status.code
  // ='canceled' (and we accept the British spelling defensively).
  if (isCanceled(event)) return 'cancelled';

  const now = new Date();
  const publicSale = event.sales?.public;
  const publicStart = publicSale?.startDateTime ? new Date(publicSale.startDateTime) : null;
  const publicEnd = publicSale?.endDateTime ? new Date(publicSale.endDateTime) : null;

  // The public sale hasn't opened yet — the event can't be sold out.
  // Distinguish presale (a currently-active entry in sales.presales[])
  // from announced (no presale window or all presale windows have passed).
  if (publicStart && publicStart > now) {
    return isCurrentlyInPresale(event, now) ? 'presale' : 'announced';
  }

  // Public sale has started (or there's no public-sale info at all).
  // From here, explicit 'offsale' or a past endDateTime means sold out.
  if (isExplicitlyOffSale(event)) return 'sold_out';
  if (publicEnd && publicEnd < now) return 'sold_out';

  return 'on_sale';
}

export function parseOnSaleDate(event: TMEvent): Date | null {
  const startDateTime = event.sales?.public?.startDateTime;
  if (!startDateTime) return null;

  const date = new Date(startDateTime);
  if (Number.isNaN(date.getTime())) return null;

  // Ticketmaster sometimes uses 1900-01-01 as a placeholder. Treat it as
  // missing so the UI does not show a bogus on-sale date.
  if (date.getUTCFullYear() < 2000) return null;

  return date;
}
