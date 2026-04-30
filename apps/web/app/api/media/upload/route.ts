import { NextRequest, NextResponse } from "next/server";
import { storeLocalObject } from "@showbook/api";

export async function PUT(request: NextRequest) {
  if ((process.env.MEDIA_STORAGE_MODE ?? "r2").toLowerCase() !== "local") {
    return NextResponse.json({ error: "Local media upload is disabled" }, { status: 404 });
  }

  const key = request.nextUrl.searchParams.get("key");
  if (!key) {
    return NextResponse.json({ error: "Missing key" }, { status: 400 });
  }

  try {
    const body = Buffer.from(await request.arrayBuffer());
    await storeLocalObject(key, body);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 400 });
  }
}
