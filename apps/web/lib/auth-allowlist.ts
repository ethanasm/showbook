// Edge-safe: this module is reachable from `auth.config.ts`, which is bundled
// into both the Node auth handler and the Edge middleware. Keep it pure —
// no Node imports, no DB calls.

export function parseAllowlist(env: string | undefined): string[] {
  return (env ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(
  email: string | null | undefined,
  opts: { emails: string[]; domains: string[] },
): boolean {
  if (opts.emails.length === 0 && opts.domains.length === 0) return true;
  if (!email) return false;
  const e = email.toLowerCase();
  if (opts.emails.includes(e)) return true;
  return opts.domains.some((d) => e.endsWith('@' + d));
}
