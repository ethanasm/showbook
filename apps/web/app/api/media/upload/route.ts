import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { decodeMobileToken } from "@/lib/mobile-token";
import { isEmailAllowed, readAllowlistFromEnv } from "@/lib/auth-allowlist";
import { resolveTrpcSession } from "../../trpc/[trpc]/resolve-session";
import {
  getMediaConfig,
  storeLocalObject,
  uploadToR2,
} from "@showbook/api";
import { child } from "@showbook/observability";

const log = child({ component: "web.api.media-upload" });

const AUTH_SECRET = process.env.AUTH_SECRET;

/**
 * Resolve the calling user. The mobile app authenticates with
 * `Authorization: Bearer <jwt>` (per the tRPC mount in
 * `app/api/trpc/[trpc]/route.ts`); the web app uses NextAuth cookies.
 * Reusing `resolveTrpcSession` keeps the two paths in sync — if a
 * removed-from-allowlist user can't hit tRPC, they can't hit this
 * route either.
 */
async function resolveUserId(req: Request): Promise<string | null> {
  const session = await resolveTrpcSession({
    authHeader: req.headers.get("authorization"),
    secret: AUTH_SECRET,
    decode: decodeMobileToken,
    allowlist: readAllowlistFromEnv(),
    isEmailAllowed,
    getCookieSession: async () => {
      const cookieSession = await auth();
      return cookieSession?.user?.id
        ? { user: { id: cookieSession.user.id } }
        : null;
    },
    log,
  });
  return session?.user?.id ?? null;
}

/**
 * PUT /api/media/upload?key=<storage-key>
 *
 * Server-side upload landing pad for the mobile + web clients. In r2
 * mode this used to short-circuit to a 404 (clients were expected to
 * PUT directly to a presigned R2 URL), but that path silently 403'd
 * for every mobile upload — 29 pending media_assets piled up in prod
 * across two months without a single one reaching `ready`, and the
 * mobile-side telemetry meant to capture R2's response body never
 * round-tripped back. Routing the bytes through this endpoint instead:
 *
 *   1. Uses `uploadToR2` (AWS SDK `PutObjectCommand`) which travels the
 *      same transport as `headFromR2` / `deleteFromR2` — i.e. the
 *      operations that already work in prod.
 *   2. Eliminates every variable in the presigned-URL chain (SDK
 *      middleware, `x-id=PutObject` query param, mobile NSURLSession
 *      header quirks, Cloudflare WAF rules on `*.r2.cloudflarestorage.com`).
 *   3. Lets the server SEE upload failures and log them. The mobile
 *      previously couldn't report 403s back because client telemetry
 *      wasn't reaching us; the server has no such gap.
 *
 * Trade-off: bandwidth doubles (mobile→server→R2 instead of mobile→R2),
 * but for ≤5 MB photos and ≤150 MB videos on a self-hosted box with
 * free R2 egress this is fine. We'll route around it if it ever becomes
 * a bottleneck.
 */
export async function PUT(request: NextRequest) {
  const config = getMediaConfig();
  if (config.storageMode === "disabled") {
    return NextResponse.json(
      { error: "Media uploads are disabled" },
      { status: 404 },
    );
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  // Keys are issued by createUploadIntent under `showbook/<userId>/...`.
  // Re-check the prefix here so an authenticated user can't PUT into
  // someone else's folder by hand-crafting the key.
  if (!key.startsWith(`showbook/${userId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isImage = config.allowedImageTypes.includes(contentType);
  const isVideo = config.allowedVideoTypes.includes(contentType);
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  const maxBytes = isVideo ? config.videoMaxBytes : config.photoMaxSourceBytes;
  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: Buffer;
  try {
    body = Buffer.from(await request.arrayBuffer());
  } catch (err) {
    log.error(
      { event: "media.upload.read_body_failed", err, key, userId },
      "Failed reading upload body",
    );
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }
  if (body.length > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const started = Date.now();
  try {
    if (config.storageMode === "local") {
      await storeLocalObject(key, body);
    } else if (config.storageMode === "r2") {
      await uploadToR2(key, body, contentType);
    } else {
      return NextResponse.json(
        { error: `Unknown storage mode: ${config.storageMode}` },
        { status: 500 },
      );
    }
  } catch (err) {
    // Bubble up R2 / S3 SDK error details so the client sees something
    // actionable instead of a generic "Upload failed". Mobile clients
    // surface `message` directly in the upload sheet — keep it short
    // but specific enough to spot credentials drift vs. transient
    // network failures.
    const code =
      err && typeof err === "object" && "name" in err
        ? (err as { name?: string }).name
        : undefined;
    const httpStatus =
      err && typeof err === "object" && "$metadata" in err
        ? (err as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;
    log.error(
      {
        event: "media.upload.r2_write_failed",
        err,
        key,
        userId,
        contentType,
        bytes: body.length,
        code,
        httpStatus,
        elapsedMs: Date.now() - started,
        storageMode: config.storageMode,
      },
      "R2 upload failed",
    );
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Upload failed", detail, code, httpStatus },
      { status: 502 },
    );
  }

  log.info(
    {
      event: "media.upload.ok",
      key,
      userId,
      contentType,
      bytes: body.length,
      elapsedMs: Date.now() - started,
      storageMode: config.storageMode,
    },
    "Upload landed in object storage",
  );

  return NextResponse.json({ ok: true });
}
