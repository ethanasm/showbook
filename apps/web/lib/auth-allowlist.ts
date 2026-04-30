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

// Read the env-driven allowlist. Called on every signIn and on every JWT
// decode so that updates to AUTH_ALLOWED_* take effect on the next request
// — there's no in-process cache to invalidate.
export function readAllowlistFromEnv(): { emails: string[]; domains: string[] } {
  return {
    emails: parseAllowlist(process.env.AUTH_ALLOWED_EMAILS),
    domains: parseAllowlist(process.env.AUTH_ALLOWED_DOMAINS),
  };
}

// Combined sign-in gate. Rejects unverified Google accounts (Workspace
// send-as / external aliases can present an arbitrary `email` with
// `email_verified: false` — without this check that would spoof a
// whitelisted address) and then defers to the allowlist.
export function shouldAllowSignIn(params: {
  email: string | null | undefined;
  emailVerified: boolean | undefined;
  emails: string[];
  domains: string[];
}): boolean {
  if (params.emailVerified === false) return false;
  return isEmailAllowed(params.email, {
    emails: params.emails,
    domains: params.domains,
  });
}
