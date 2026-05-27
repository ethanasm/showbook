import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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

// Force the route onto the Node runtime + dynamic so Next.js doesn't try
// to statically optimise it, and the `auth()` / AWS SDK calls run on a
// real Node process every request.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Plain-text response with explicit Content-Length and `Connection: close`.
 *
 * iOS NSURLSession background upload tasks (which is what
 * `expo-file-system`'s `createUploadTask` uses for ≥ a few MB) parse the
 * server response through `LocalDownloadTask`, which has been observed to
 * reject `NextResponse.json()` chunked-encoded responses with
 * `NSURLErrorCannotParseResponse (-1017)` when the connection is HTTP/2
 * via Cloudflare Tunnel. A small `text/plain` body with explicit
 * Content-Length and a directive to close the connection sidesteps that
 * parser. Same shape on success and on errors so the iOS side never has
 * to negotiate a content-type mid-response.
 */
function plainResponse(
  status: number,
  body: string,
): NextResponse {
  const bytes = Buffer.byteLength(body, "utf8");
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": String(bytes),
      "Cache-Control": "no-store",
      Connection: "close",
    },
  });
}

/**
 * PUT /api/media/upload?key=<storage-key>
 *
 * Server-side upload landing pad for the mobile + web clients. Writes the
 * request body to R2 (or to local disk in `local` storage mode) using the
 * AWS SDK — the same transport that already works in prod for
 * `headFromR2` / `deleteFromR2`. The previous direct-to-R2 presigned URL
 * path silently 403'd every mobile upload for two months (#397).
 *
 * The body is read in full BEFORE the storage write so we never half-close
 * an iOS background URLSession's upload stream with an early failure
 * response — iOS treats that as an unparseable response and surfaces
 * `NSURLErrorCannotParseResponse (-1017)`, which masks the real error.
 */
export async function PUT(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();

  // Unconditional entry log so we always have evidence the route was
  // reached, independent of where it later fails. The mobile-side
  // telemetry sink has been silent in prod for 30+ days, so this is
  // our only signal that the upload made it to the server.
  log.info(
    {
      event: "media.upload.request",
      requestId,
      contentLengthHeader: request.headers.get("content-length"),
      contentTypeHeader: request.headers.get("content-type"),
      userAgent: request.headers.get("user-agent"),
    },
    "Upload request received",
  );

  const config = getMediaConfig();
  if (config.storageMode === "disabled") {
    return plainResponse(404, "media uploads are disabled");
  }

  const userId = await resolveUserId(request);
  if (!userId) {
    return plainResponse(401, "unauthorized");
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return plainResponse(400, "missing key");
  }

  if (!key.startsWith(`showbook/${userId}/`)) {
    return plainResponse(403, "forbidden");
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isImage = config.allowedImageTypes.includes(contentType);
  const isVideo = config.allowedVideoTypes.includes(contentType);
  if (!isImage && !isVideo) {
    return plainResponse(415, `unsupported content type: ${contentType}`);
  }

  const maxBytes = isVideo ? config.videoMaxBytes : config.photoMaxSourceBytes;
  const declaredLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return plainResponse(413, "payload too large");
  }

  // Drain the request body to completion BEFORE doing anything that could
  // fail. iOS NSURLSession background upload tasks treat an early server
  // response (mid-upload) as a protocol error and surface it as
  // `NSURLErrorCannotParseResponse (-1017)`, masking whatever real error
  // the server tried to communicate. Keeping the body read at the top
  // means the server only responds once the upload stream is fully
  // consumed.
  let body: Buffer;
  try {
    body = Buffer.from(await request.arrayBuffer());
  } catch (err) {
    log.error(
      { event: "media.upload.read_body_failed", err, key, userId, requestId },
      "Failed reading upload body",
    );
    return plainResponse(400, "failed to read upload body");
  }
  if (body.length > maxBytes) {
    return plainResponse(413, "payload too large");
  }

  try {
    if (config.storageMode === "local") {
      await storeLocalObject(key, body);
    } else if (config.storageMode === "r2") {
      await uploadToR2(key, body, contentType);
    } else {
      return plainResponse(500, `unknown storage mode: ${config.storageMode}`);
    }
  } catch (err) {
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
        requestId,
        contentType,
        bytes: body.length,
        code,
        httpStatus,
        elapsedMs: Date.now() - startedAt,
        storageMode: config.storageMode,
      },
      "Object storage write failed",
    );
    const detail = err instanceof Error ? err.message : String(err);
    return plainResponse(502, `upload failed: ${code ?? "error"}: ${detail}`);
  }

  log.info(
    {
      event: "media.upload.ok",
      key,
      userId,
      requestId,
      contentType,
      bytes: body.length,
      elapsedMs: Date.now() - startedAt,
      storageMode: config.storageMode,
    },
    "Upload landed in object storage",
  );

  // 204 No Content keeps the response body empty so iOS NSURLSession has
  // nothing to parse beyond the headers — the simplest possible shape
  // for a successful upload, which is exactly what flaky HTTP/2 + iOS
  // upload-task combos need.
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Content-Length": "0",
      "Cache-Control": "no-store",
      Connection: "close",
    },
  });
}
