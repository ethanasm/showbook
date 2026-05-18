import { NextResponse, type NextRequest } from "next/server";
import { db, userPreferences } from "@showbook/db";
import { verifyUnsubscribeToken } from "@showbook/api";
import { child } from "@showbook/observability";

const log = child({ component: "api.unsubscribe" });

/**
 * Public one-click unsubscribe endpoint for the daily-digest emails.
 *
 * Both `GET` and `POST` are wired:
 *   - `GET ?t=<token>` is what a user clicks in the email body link.
 *     Renders a tiny success page on completion.
 *   - `POST ?t=<token>` is what RFC 8058 mail clients hit when the
 *     `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header is
 *     honoured (Gmail / Apple Mail / Outlook all do this on the
 *     "Unsubscribe" chip above the email body). Returns 204.
 *
 * Authentication is via the signed token alone — the request lands
 * cookie-less from the user's inbox. The token is an HMAC over
 * `userId` using `AUTH_SECRET` (see `@showbook/api/unsubscribe-token`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function applyUnsubscribe(token: string | null) {
  if (!token) return { ok: false, status: 400 as const, reason: "missing_token" };
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return { ok: false, status: 401 as const, reason: "invalid_token" };
  // Idempotent. If the row doesn't exist yet (user never opened
  // Preferences), insert with the digest off so the unsubscribe
  // sticks even before the row materialises.
  await db
    .insert(userPreferences)
    .values({ userId, emailNotifications: false })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: { emailNotifications: false },
    });
  log.info(
    { event: "notifications.digest.unsubscribed", userId, source: "one_click" },
    "User unsubscribed via List-Unsubscribe token",
  );
  return { ok: true as const, status: 200 as const };
}

export async function GET(req: NextRequest) {
  const result = await applyUnsubscribe(req.nextUrl.searchParams.get("t"));
  if (!result.ok) {
    return new NextResponse(renderHtml({ ok: false, reason: result.reason }), {
      status: result.status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return new NextResponse(renderHtml({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function POST(req: NextRequest) {
  const result = await applyUnsubscribe(req.nextUrl.searchParams.get("t"));
  return new NextResponse(null, { status: result.ok ? 204 : result.status });
}

function renderHtml({
  ok,
  reason,
}: {
  ok: boolean;
  reason?: string;
}): string {
  if (ok) {
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Unsubscribed · Showbook</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { background: #0C0C0C; color: #F5F5F3; font-family: -apple-system, "Space Grotesk", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .card { max-width: 460px; padding: 32px 28px; background: #141414; border: 1px solid rgba(245,245,243,.22); border-radius: 12px; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.5; color: rgba(245,245,243,.75); margin: 0 0 16px; }
  a { color: #FFD166; text-decoration: underline; text-underline-offset: 3px; }
</style></head>
<body><div class="card">
  <h1>You're unsubscribed.</h1>
  <p>We won't send any more daily digests to this account.</p>
  <p>Changed your mind? <a href="/preferences">Turn email notifications back on in Preferences.</a></p>
</div></body></html>`;
  }
  const message =
    reason === "missing_token"
      ? "No unsubscribe token was provided."
      : "This unsubscribe link is invalid or has been tampered with.";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Unsubscribe failed · Showbook</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { background: #0C0C0C; color: #F5F5F3; font-family: -apple-system, "Space Grotesk", sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .card { max-width: 460px; padding: 32px 28px; background: #141414; border: 1px solid rgba(245,245,243,.22); border-radius: 12px; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.5; color: rgba(245,245,243,.75); margin: 0 0 16px; }
  a { color: #FFD166; text-decoration: underline; text-underline-offset: 3px; }
</style></head>
<body><div class="card">
  <h1>Couldn't unsubscribe</h1>
  <p>${message}</p>
  <p>You can always turn off email notifications from <a href="/preferences">Preferences</a> while signed in.</p>
</div></body></html>`;
}
