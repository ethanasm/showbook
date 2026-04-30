"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Tag, Trash2, Upload, Video, X, ImagePlus } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { uploadPhotoForShow, uploadVideoForShow } from "./uploadHelpers";
import "./media.css";

type MediaScope = "show" | "venue" | "performer";

export type MediaPerformer = { id: string; name: string };

type MediaAsset = {
  id: string;
  mediaType: "photo" | "video";
  bytes: number;
  durationMs?: number | null;
  urls: Record<string, string>;
  performerIds?: string[];
  sourceShow?: {
    id: string;
    title: string;
    date: string | null;
    venue: { id: string; name: string } | null;
  } | null;
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

export function MediaSection({
  scope,
  showId,
  venueId,
  performerId,
  lineup = [],
  canUpload = true,
}: {
  scope: MediaScope;
  showId?: string;
  venueId?: string;
  performerId?: string;
  lineup?: MediaPerformer[];
  // Only meaningful for scope === "show". When false, the upload UI is
  // hidden — the server also rejects uploads for non-past events.
  canUpload?: boolean;
}) {
  const utils = trpc.useUtils();
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openTagPickerFor, setOpenTagPickerFor] = useState<string | null>(null);

  // Auto-tag rule: a photo uploaded from a single-performer show gets
  // tagged with that performer. Multi-performer shows leave new uploads
  // untagged so the user can pick per asset.
  const defaultPerformerIds = useMemo(
    () => (lineup.length === 1 && lineup[0] ? [lineup[0].id] : []),
    [lineup],
  );

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
  const setPerformersMutation = trpc.media.setPerformers.useMutation({
    onSuccess: () => {
      invalidateMedia();
      // setPerformers may auto-add a performer to the show's lineup
      // (showPerformers row), so refresh the show detail too.
      if (showId) utils.shows.detail.invalidate({ showId });
    },
  });

  // Local cache of performer name → id learned from search results, so
  // chips can render the right label even before listForShow refetches.
  const [knownNames, setKnownNames] = useState<Record<string, string>>({});
  function rememberName(id: string, name: string) {
    setKnownNames((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }));
  }

  async function setAssetPerformers(asset: MediaAsset, performerIds: string[]) {
    await setPerformersMutation.mutateAsync({
      assetId: asset.id,
      performerIds,
    });
  }

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

  async function handlePhoto(file: File) {
    if (!showId) return;
    setError(null);
    try {
      await uploadPhotoForShow({
        showId,
        file,
        performerIds: defaultPerformerIds,
        createIntent: (input) => createIntent.mutateAsync(input),
        completeUpload: (input) => completeUpload.mutateAsync(input),
        onStatus: setStatus,
      });
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
    try {
      await uploadVideoForShow({
        showId,
        file,
        performerIds: defaultPerformerIds,
        createIntent: (input) => createIntent.mutateAsync(input),
        completeUpload: (input) => completeUpload.mutateAsync(input),
        onStatus: setStatus,
      });
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

      {scope === "show" && canUpload && (
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
          {assets.map((asset) => {
            const showTagPicker = scope === "show";
            const isPickerOpen = openTagPickerFor === asset.id;
            return (
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
                {showTagPicker && (
                  <TagEditor
                    asset={asset}
                    lineup={lineup}
                    knownNames={knownNames}
                    rememberName={rememberName}
                    isOpen={isPickerOpen}
                    onToggleOpen={() =>
                      setOpenTagPickerFor(isPickerOpen ? null : asset.id)
                    }
                    onCommit={(ids) => setAssetPerformers(asset, ids)}
                    isPending={setPerformersMutation.isPending}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function TagEditor({
  asset,
  lineup,
  knownNames,
  rememberName,
  isOpen,
  onToggleOpen,
  onCommit,
  isPending,
}: {
  asset: MediaAsset;
  lineup: MediaPerformer[];
  knownNames: Record<string, string>;
  rememberName: (id: string, name: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onCommit: (performerIds: string[]) => Promise<void>;
  isPending: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setDebouncedQuery("");
    }
  }, [isOpen]);

  const search = trpc.performers.search.useQuery(
    { query: debouncedQuery },
    { enabled: isOpen && debouncedQuery.length >= 1 },
  );

  const performerIds = asset.performerIds ?? [];
  const nameFor = (id: string): string => {
    const fromLineup = lineup.find((p) => p.id === id)?.name;
    if (fromLineup) return fromLineup;
    return knownNames[id] ?? "Unknown performer";
  };
  const tagged = performerIds.map((id) => ({ id, name: nameFor(id) }));

  async function addPerformer(p: { id: string; name: string }) {
    rememberName(p.id, p.name);
    if (performerIds.includes(p.id)) return;
    await onCommit([...performerIds, p.id]);
    setQuery("");
  }

  async function removePerformer(id: string) {
    await onCommit(performerIds.filter((existing) => existing !== id));
  }

  const results = (search.data ?? []).filter(
    (row) => !performerIds.includes(row.id),
  );

  return (
    <div className="media-card__tags" data-testid="media-card-tags">
      {tagged.map((p) => (
        <span key={p.id} className="media-tag">
          {p.name}
          <button
            type="button"
            className="media-tag__remove"
            aria-label={`Remove ${p.name}`}
            disabled={isPending}
            onClick={() => removePerformer(p.id)}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <button
        type="button"
        className="media-tag media-tag--button"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
        data-testid="media-tag-edit"
      >
        <Tag size={11} />
        {tagged.length === 0 ? "Tag performers" : "Add"}
      </button>
      {isOpen && (
        <div className="media-tag-picker" data-testid="media-tag-picker">
          <input
            type="text"
            className="media-tag-picker__search"
            placeholder="Search performers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            data-testid="media-tag-search"
          />
          <div className="media-tag-picker__results">
            {debouncedQuery.length === 0 ? (
              <div className="media-tag-picker__hint">
                Type a performer name. Selecting one not yet on this show
                will add them to the lineup.
              </div>
            ) : search.isLoading ? (
              <div className="media-tag-picker__hint">Searching…</div>
            ) : results.length === 0 ? (
              <div className="media-tag-picker__hint">No matches.</div>
            ) : (
              results.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="media-tag-picker__row"
                  disabled={isPending}
                  onClick={() => addPerformer({ id: row.id, name: row.name })}
                >
                  {row.name}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

