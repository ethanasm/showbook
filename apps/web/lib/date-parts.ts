import { formatDateParts as sharedFormatDateParts } from "@showbook/shared";

const UPPER_MONTHS = new Set([
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
]);

/**
 * Web's date parts. Wraps the shared `formatDateParts` and title-cases the
 * month it returns.
 *
 * The shared helper upper-cases the month (`SEP`) because every date on both
 * surfaces used to be set in Geist Mono under an uppercase transform. The web
 * type system no longer upper-cases anything, so the shape of the string has
 * to change with it — `Sep 11`, not `SEP 11`. The shared helper keeps its
 * uppercase output for the mobile app, which is out of scope for this pass.
 *
 * Import this rather than `formatDateParts` from `@showbook/shared` anywhere
 * in `apps/web`; a direct import bypasses the re-casing and puts a shouting
 * month back on the screen.
 */
export const formatDateParts: typeof sharedFormatDateParts = (
  date,
  fallback?,
) => {
  const parts = fallback
    ? sharedFormatDateParts(date, fallback)
    : sharedFormatDateParts(date);
  // Only a real month abbreviation is re-cased — the fallback months
  // ("TBD", "—") must survive untouched.
  if (!UPPER_MONTHS.has(parts.month)) return parts;
  return {
    ...parts,
    month: parts.month.charAt(0) + parts.month.slice(1).toLowerCase(),
  };
};

export { formatDateParts as toDateParts };
