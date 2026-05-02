/**
 * Admin allowlist helper. Mirrors `apps/web/lib/auth-allowlist.ts` in spirit
 * but with a deliberately *closed* default: an empty/unset `ADMIN_EMAILS`
 * grants admin to no one. This is what backs the `adminProcedure` middleware
 * in `./trpc.ts` and the `admin.amIAdmin` query the web sidebar uses to
 * decide whether to render the Admin tab.
 *
 * Pure: no DB, no IO. Edge-safe.
 */

export function parseAdminEmails(env: string | undefined): string[] {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true iff `email` matches an entry in the comma-separated
 * `ADMIN_EMAILS` env var (case-insensitive). Pass `list` explicitly in tests
 * so we don't have to mutate `process.env`.
 *
 * Closed by default: empty list ⇒ false, missing email ⇒ false.
 */
export function isAdminEmail(
  email: string | null | undefined,
  list: string[] = parseAdminEmails(process.env.ADMIN_EMAILS),
): boolean {
  if (list.length === 0) return false;
  if (!email) return false;
  return list.includes(email.toLowerCase());
}
