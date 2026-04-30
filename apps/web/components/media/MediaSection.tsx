"use client";

import { useMemo, useRef, useState } from "react";
import { ImagePlus, Trash2, Upload, Video } from "lucide-react";
import { trpc } from "@/lib/trpc";
import "./media.css";

type MediaScope = "show" | "venue" | "performer";

type MediaAsset = {
  id: string;
  mediaType: "photo" | "video";
  bytes: number;
  durationMs?: number | null;
  urls: Record<string, string>;
  sourceShow?: {
    id: string;
    title: string;
    date: string | null;
    venue: { id: string; name: string } | null;
  } | null;
};

type VariantBlob = {
  name: string;
  blob: Blob;
  width: number;
  height: number;
};

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function formatDate(date: string | null | undefined): string {
  if (!date) return "date tbd";
  const parsed = new Date(`${date}T00:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

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

async function buildImageVariants(file: File): Promise<{
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

function readVideoMetadata(file: File): Promise<{
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

export function MediaSection({
  scope,
  showId,
  venueId,
  performerId,
  defaultPerformerIds = [],
}: {
  scope: MediaScope;
  showId?: string;
  venueId?: string;
  performerId?: string;
  defaultPerformerIds?: string[];
}) {
  const utils = trpc.useUtils();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const showMedia = trpc.media.listForShow.useQuery(
    { showId: showId ?? "" },
    { enabled: scope === "show" && Boolean(showId) },
  );
  const venueMedia = trpc.media.listForVenue.useQuery(
    { venueId: venueId ?? "" },
    { enabled: scope === "venue" && Boolean(venueId) },
  );
  const performerMedia = trpc.media.listForPerformer.useQuery(
    { performerId: performerId ?? "" },
    { enabled: scope === "performer" && Boolean(performerId) },
  );
  const quota = trpc.media.getQuota.useQuery(
    { showId: showId ?? "" },
    { enabled: scope === "show" && Boolean(showId) },
  );

  const createIntent = trpc.media.createUploadIntent.useMutation();
  const completeUpload = trpc.media.completeUpload.useMutation();
  const deleteMedia = trpc.media.delete.useMutation({
    onSuccess: () => invalidateMedia(),
  });

  const assets = useMemo(() => {
    if (scope === "show") return (showMedia.data ?? []) as MediaAsset[];
    if (scope === "venue") return (venueMedia.data ?? []) as MediaAsset[];
    return (performerMedia.data ?? []) as MediaAsset[];
  }, [performerMedia.data, scope, showMedia.data, venueMedia.data]);

  const isLoading =
    showMedia.isLoading || venueMedia.isLoading || performerMedia.isLoading;
  const isUploading = createIntent.isPending || completeUpload.isPending || Boolean(status);
  const quotaData = quota.data;
  const userUsed = quotaData?.used.userBytes ?? 0;
  const userLimit = quotaData?.limits.userBytes ?? 1;
  const showUsed = quotaData?.used.showBytes ?? 0;
  const showLimit = quotaData?.limits.showBytes ?? 1;
  const quotaPct = Math.min(100, Math.round((showUsed / showLimit) * 100));
  const uploadBlocked =
    scope === "show" &&
    quotaData &&
    (quotaData.used.showBytes >= quotaData.limits.showBytes ||
      quotaData.used.showPhotos >= quotaData.limits.showMaxPhotos ||
      quotaData.used.showVideos >= quotaData.limits.showMaxVideos);

  function invalidateMedia() {
    if (showId) {
      utils.media.listForShow.invalidate({ showId });
      utils.media.getQuota.invalidate({ showId });
    }
    if (venueId) utils.media.listForVenue.invalidate({ venueId });
    if (performerId) utils.media.listForPerformer.invalidate({ performerId });
  }

  async function uploadTarget(uploadUrl: string, blob: Blob, mimeType: string) {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": mimeType },
      body: blob,
    });
    if (!response.ok) throw new Error("Upload failed");
  }

  async function handlePhoto(file: File) {
    if (!showId) return;
    setError(null);
    setStatus("Preparing photo");
    try {
      const prepared = await buildImageVariants(file);
      const storedBytes = prepared.variants.reduce((sum, item) => sum + item.blob.size, 0);
      setStatus("Reserving storage");
      const intent = await createIntent.mutateAsync({
        showId,
        mediaType: "photo",
        mimeType: file.type || "image/jpeg",
        sourceBytes: file.size,
        storedBytes,
        width: prepared.width,
        height: prepared.height,
        performerIds: defaultPerformerIds,
        variants: prepared.variants.map((variant) => ({
          name: variant.name,
          mimeType: "image/webp",
          bytes: variant.blob.size,
          width: variant.width,
          height: variant.height,
        })),
      });

      setStatus("Uploading photo");
      for (const target of intent.targets) {
        const variant = prepared.variants.find((item) => item.name === target.name);
        if (!variant) throw new Error("Missing image variant");
        await uploadTarget(target.uploadUrl, variant.blob, target.mimeType);
      }

      setStatus("Finishing upload");
      await completeUpload.mutateAsync({ assetId: intent.assetId });
      invalidateMedia();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setStatus(null);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function handleVideo(file: File) {
    if (!showId) return;
    setError(null);
    setStatus("Reading video");
    try {
      const metadata = await readVideoMetadata(file);
      setStatus("Reserving storage");
      const intent = await createIntent.mutateAsync({
        showId,
        mediaType: "video",
        mimeType: file.type || "video/mp4",
        sourceBytes: file.size,
        storedBytes: file.size,
        width: metadata.width,
        height: metadata.height,
        durationMs: metadata.durationMs,
        performerIds: defaultPerformerIds,
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
      setStatus("Uploading video");
      await uploadTarget(target.uploadUrl, file, target.mimeType);
      setStatus("Finishing upload");
      await completeUpload.mutateAsync({ assetId: intent.assetId });
      invalidateMedia();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video upload failed");
    } finally {
      setStatus(null);
      if (videoInputRef.current) videoInputRef.current.value = "";
    }
  }

  function sourceLabel(asset: MediaAsset): string {
    if (scope === "show") {
      return asset.mediaType === "photo" ? formatBytes(asset.bytes) : `video · ${formatBytes(asset.bytes)}`;
    }
    const show = asset.sourceShow;
    if (!show) return formatBytes(asset.bytes);
    const place = show.venue?.name ? ` · ${show.venue.name}` : "";
    return `${show.title} · ${formatDate(show.date)}${scope === "performer" ? place : ""}`;
  }

  return (
    <section className="media-section" data-testid="media-section">
      <div className="media-section__header">
        <div>
          <div className="media-section__eyebrow">
            {scope === "show" ? `Media · ${assets.length}` : `Media from your shows · ${assets.length}`}
          </div>
          <div className="media-section__note">
            photos and short mp4 memories stored in Showbook
          </div>
        </div>
      </div>

      {scope === "show" && (
        <>
          <div className="media-uploader">
            <div>
              <div className="media-uploader__title">Add event media</div>
              <div className="media-uploader__meta">
                Up to {quotaData?.limits.showMaxPhotos ?? 30} photos and{" "}
                {quotaData?.limits.showMaxVideos ?? 2} videos for this show. Videos must be MP4.
              </div>
            </div>
            <div className="media-uploader__actions">
              <button
                type="button"
                className="media-button media-button--primary"
                disabled={Boolean(uploadBlocked) || isUploading}
                onClick={() => photoInputRef.current?.click()}
              >
                <ImagePlus size={14} /> Photo
              </button>
              <button
                type="button"
                className="media-button"
                disabled={Boolean(uploadBlocked) || isUploading}
                onClick={() => videoInputRef.current?.click()}
              >
                <Video size={14} /> Video
              </button>
              <input
                ref={photoInputRef}
                className="media-file-input"
                data-testid="media-photo-input"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handlePhoto(file);
                }}
              />
              <input
                ref={videoInputRef}
                className="media-file-input"
                data-testid="media-video-input"
                type="file"
                accept="video/mp4"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleVideo(file);
                }}
              />
            </div>
          </div>

          {quotaData && (
            <div className="media-quota" data-testid="media-quota">
              <div className="media-quota__track" aria-hidden="true">
                <div className="media-quota__bar" style={{ width: `${quotaPct}%` }} />
              </div>
              <div className="media-quota__copy">
                {formatBytes(showUsed)} / {formatBytes(showLimit)} show ·{" "}
                {formatBytes(userUsed)} / {formatBytes(userLimit)} user
              </div>
            </div>
          )}
        </>
      )}

      {status && (
        <div className="media-status" data-testid="media-upload-status">
          <Upload size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
          {status}…
        </div>
      )}
      {error && (
        <div className="media-status media-status--error" data-testid="media-upload-error">
          {error}
        </div>
      )}
      {uploadBlocked && (
        <div className="media-status media-status--error" data-testid="media-quota-blocked">
          This show has reached its media limit.
        </div>
      )}

      {isLoading ? (
        <div className="media-empty">
          <div>
            <div className="media-empty__title">Loading media</div>
            <div className="media-empty__body">Collecting photos and videos for this view.</div>
          </div>
        </div>
      ) : assets.length === 0 ? (
        <div className="media-empty">
          <div>
            <div className="media-empty__title">No media yet</div>
            <div className="media-empty__body">
              {scope === "show"
                ? "Add a few photos or a short video from the night."
                : "Media uploaded to matching shows will collect here automatically."}
            </div>
          </div>
        </div>
      ) : (
        <div className="media-grid" data-testid="media-gallery">
          {assets.map((asset) => (
            <article className="media-card" key={asset.id}>
              <div className="media-card__frame">
                {asset.mediaType === "photo" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={asset.urls.card ?? asset.urls.full ?? asset.urls.thumb} alt="" />
                ) : (
                  <video src={asset.urls.source} controls preload="metadata" />
                )}
              </div>
              <div className="media-card__meta">
                <div className="media-card__label" title={sourceLabel(asset)}>
                  {sourceLabel(asset)}
                </div>
                {scope === "show" && (
                  <button
                    type="button"
                    className="media-card__delete"
                    aria-label="Delete media"
                    onClick={() => deleteMedia.mutate({ assetId: asset.id })}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
