type VariantBlob = {
  name: string;
  blob: Blob;
  width: number;
  height: number;
};

type VariantInput = {
  name: string;
  mimeType: string;
  bytes: number;
  width?: number;
  height?: number;
};

type IntentInput = {
  showId: string;
  mediaType: "photo" | "video";
  mimeType: string;
  sourceBytes: number;
  storedBytes: number;
  width?: number;
  height?: number;
  durationMs?: number;
  caption?: string;
  performerIds?: string[];
  variants: VariantInput[];
};

type IntentResult = {
  assetId: string;
  targets: { name: string; key: string; mimeType: string; uploadUrl: string }[];
};

export type CreateIntentFn = (input: IntentInput) => Promise<IntentResult>;
export type CompleteUploadFn = (input: { assetId: string }) => Promise<unknown>;

export type StatusReporter = (status: string | null) => void;

function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

async function fileToBitmap(file: File): Promise<{ bitmap: ImageBitmap; sourceMime: string }> {
  if (isHeic(file)) {
    const { heicTo } = await import("heic-to");
    const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    return { bitmap: await createImageBitmap(blob), sourceMime: "image/jpeg" };
  }
  return { bitmap: await createImageBitmap(file), sourceMime: file.type || "image/jpeg" };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Could not process image"));
      else resolve(blob);
    }, type, quality);
  });
}

export async function buildImageVariants(file: File): Promise<{
  width: number;
  height: number;
  variants: VariantBlob[];
  sourceMime: string;
}> {
  const { bitmap, sourceMime } = await fileToBitmap(file);
  const sizes = [
    { name: "thumb", max: 260, quality: 0.78 },
    { name: "card", max: 760, quality: 0.82 },
    { name: "full", max: 1600, quality: 0.86 },
  ];

  const variants: VariantBlob[] = [];
  for (const size of sizes) {
    const scale = Math.min(1, size.max / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process image");
    ctx.drawImage(bitmap, 0, 0, width, height);
    variants.push({
      name: size.name,
      blob: await canvasToBlob(canvas, "image/webp", size.quality),
      width,
      height,
    });
  }

  bitmap.close();
  return { width: variants[2]?.width ?? 0, height: variants[2]?.height ?? 0, variants, sourceMime };
}

// Anchored allowlist for the well-formed shape that the browser produces from
// URL.createObjectURL. We reject any other shape — including hypothetical
// `javascript:` payloads — before letting the value reach video.src.
const SAFE_BLOB_URL = /^blob:(?:[a-z]+:\/\/[^\s/]+|null)\/[A-Za-z0-9-]+$/;

export function readVideoMetadata(file: File): Promise<{
  width?: number;
  height?: number;
  durationMs?: number;
}> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    // URL.createObjectURL always returns a same-origin `blob:` URL, but make
    // the contract explicit so user-supplied File data can't reach video.src
    // as anything other than a properly-shaped blob reference.
    if (!SAFE_BLOB_URL.test(objectUrl)) {
      URL.revokeObjectURL(objectUrl);
      resolve({});
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const result = {
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        durationMs: Number.isFinite(video.duration)
          ? Math.round(video.duration * 1000)
          : undefined,
      };
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({});
    };
    video.src = objectUrl;
  });
}

async function uploadTarget(uploadUrl: string, blob: Blob, mimeType: string) {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: blob,
  });
  if (!response.ok) throw new Error("Upload failed");
}

type UploadOptions = {
  showId: string;
  file: File;
  caption?: string;
  performerIds?: string[];
  createIntent: CreateIntentFn;
  completeUpload: CompleteUploadFn;
  onStatus?: StatusReporter;
};

export async function uploadPhotoForShow(opts: UploadOptions): Promise<{ assetId: string }> {
  const { showId, file, caption, performerIds, createIntent, completeUpload, onStatus } = opts;
  onStatus?.("Preparing photo");
  const prepared = await buildImageVariants(file);
  const storedBytes = prepared.variants.reduce((sum, item) => sum + item.blob.size, 0);
  onStatus?.("Reserving storage");
  const intent = await createIntent({
    showId,
    mediaType: "photo",
    mimeType: prepared.sourceMime || file.type || "image/jpeg",
    sourceBytes: file.size,
    storedBytes,
    width: prepared.width,
    height: prepared.height,
    caption,
    performerIds,
    variants: prepared.variants.map((variant) => ({
      name: variant.name,
      mimeType: "image/webp",
      bytes: variant.blob.size,
      width: variant.width,
      height: variant.height,
    })),
  });

  onStatus?.("Uploading photo");
  for (const target of intent.targets) {
    const variant = prepared.variants.find((item) => item.name === target.name);
    if (!variant) throw new Error("Missing image variant");
    await uploadTarget(target.uploadUrl, variant.blob, target.mimeType);
  }

  onStatus?.("Finishing upload");
  await completeUpload({ assetId: intent.assetId });
  return { assetId: intent.assetId };
}

export async function uploadVideoForShow(opts: UploadOptions): Promise<{ assetId: string }> {
  const { showId, file, caption, performerIds, createIntent, completeUpload, onStatus } = opts;
  onStatus?.("Reading video");
  const metadata = await readVideoMetadata(file);
  onStatus?.("Reserving storage");
  const intent = await createIntent({
    showId,
    mediaType: "video",
    mimeType: file.type || "video/mp4",
    sourceBytes: file.size,
    storedBytes: file.size,
    width: metadata.width,
    height: metadata.height,
    durationMs: metadata.durationMs,
    caption,
    performerIds,
    variants: [
      {
        name: "source",
        mimeType: file.type || "video/mp4",
        bytes: file.size,
        width: metadata.width,
        height: metadata.height,
      },
    ],
  });
  const target = intent.targets[0];
  if (!target) throw new Error("Upload target missing");
  onStatus?.("Uploading video");
  await uploadTarget(target.uploadUrl, file, target.mimeType);
  onStatus?.("Finishing upload");
  await completeUpload({ assetId: intent.assetId });
  return { assetId: intent.assetId };
}
