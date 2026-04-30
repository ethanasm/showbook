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

async function fileToBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
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
}> {
  const bitmap = await fileToBitmap(file);
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
  return { width: variants[2]?.width ?? 0, height: variants[2]?.height ?? 0, variants };
}

export function readVideoMetadata(file: File): Promise<{
  width?: number;
  height?: number;
  durationMs?: number;
}> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
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
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({});
    };
    video.src = url;
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
    mimeType: file.type || "image/jpeg",
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
