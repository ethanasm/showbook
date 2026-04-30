import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getMediaConfig, storeLocalObject } from "@showbook/api";

export async function PUT(request: NextRequest) {
  if ((process.env.MEDIA_STORAGE_MODE ?? "r2").toLowerCase() !== "local") {
    return NextResponse.json({ error: "Local media upload is disabled" }, { status: 404 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  // Keys are issued by createUploadIntent under `showbook/<userId>/...`.
  // Re-check the prefix here so an authenticated user can't PUT into someone
  // else's folder by hand-crafting the key.
  if (!key.startsWith(`showbook/${userId}/`)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = getMediaConfig();
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  const isImage = config.allowedImageTypes.includes(contentType);
  const isVideo = config.allowedVideoTypes.includes(contentType);
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 415 });
  }

  const maxBytes = isVideo ? config.videoMaxBytes : config.photoMaxSourceBytes;
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  try {
    const body = Buffer.from(await request.arrayBuffer());
    if (body.length > maxBytes) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    await storeLocalObject(key, body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }
}
