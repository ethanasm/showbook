import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless one-click unsubscribe token used in the `List-Unsubscribe`
 * header on every daily-digest email + the in-body visible link.
 *
 * Why HMAC and not a DB row? The recipient clicking a link from their
 * inbox has no NextAuth session — the request lands cookie-less.
 * Signing a `<userId>.<hmac>` payload with `AUTH_SECRET` (the same
 * env var NextAuth uses for its JWT signature) lets the unsubscribe
 * endpoint authenticate the request purely from the URL, with no
 * write to the DB at link-generation time.
 *
 * AUTH_SECRET is already mandatory in prod for NextAuth itself, so we
 * reuse it rather than introduce a new env var; the inputs are
 * concatenated with a `\0` separator + a domain-prefix string so the
 * HMAC can never be confused with a NextAuth JWT signature.
 */
const DOMAIN_PREFIX = 'showbook.unsubscribe.v1';

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      'AUTH_SECRET is required to mint unsubscribe tokens — set it in .env.prod',
    );
  }
  return secret;
}

function computeHmac(userId: string): string {
  return createHmac('sha256', getSecret())
    .update(`${DOMAIN_PREFIX}\0${userId}`)
    .digest('hex');
}

export function signUnsubscribeToken(userId: string): string {
  return `${userId}.${computeHmac(userId)}`;
}

/**
 * Returns the userId encoded in the token iff the signature verifies,
 * else null. Uses `timingSafeEqual` so a brute-force attacker can't
 * learn token prefixes from response timing.
 */
export function verifyUnsubscribeToken(token: string): string | null {
  const sep = token.lastIndexOf('.');
  if (sep <= 0 || sep >= token.length - 1) return null;
  const userId = token.slice(0, sep);
  const provided = token.slice(sep + 1);
  const expected = computeHmac(userId);
  if (provided.length !== expected.length) return null;
  // `Buffer.from` allocates once each; `timingSafeEqual` rejects on
  // length mismatch so the length check above is belt-and-suspenders.
  const ok = timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8'),
  );
  return ok ? userId : null;
}
