"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AddShowMediaStaging,
  type StagedMediaItem,
  uploadPhotoForShow,
  uploadVideoForShow,
} from "@/components/media";
import type { CreateIntentFn, CompleteUploadFn } from "@/components/media/uploadHelpers";
import { mono } from "@/app/(app)/add/constants";

interface MediaStagingApi {
  stagedMedia: StagedMediaItem[];
  setStagedMedia: React.Dispatch<React.SetStateAction<StagedMediaItem[]>>;
  mediaUploadStatus: string | null;
  setMediaUploadStatus: React.Dispatch<React.SetStateAction<string | null>>;
  mediaUploadErrors: string[];
  setMediaUploadErrors: React.Dispatch<React.SetStateAction<string[]>>;
  runUploads: (args: {
    targetShowId: string;
    targetShowPerformers: Array<{ performer?: { id?: string; name?: string } | null } | null | undefined>;
    createUploadIntent: CreateIntentFn;
    completeUpload: CompleteUploadFn;
  }) => Promise<{ ok: boolean; errors: string[] }>;
}

/**
 * State + upload-lifecycle plumbing for the Add page's photo/video
 * staging section. Owns the staged-files list, the live upload-status
 * string, and the partial-failure error list; also exposes the
 * `runUploads` helper that handleFormSave loops over after a show is
 * created.
 *
 * `canStageMedia` drives a side effect that revokes preview URLs and
 * clears staged files when the user moves the date to one where the
 * show hasn't started yet — the staging UI hides in that case and the
 * files would otherwise sneak through on save.
 */
export function useMediaStaging(args: { canStageMedia: boolean }): MediaStagingApi {
  const { canStageMedia } = args;
  const [stagedMedia, setStagedMedia] = useState<StagedMediaItem[]>([]);
  const [mediaUploadStatus, setMediaUploadStatus] = useState<string | null>(null);
  const [mediaUploadErrors, setMediaUploadErrors] = useState<string[]>([]);

  // If the user moves the date to one where the show hasn't started, the
  // staging UI hides — drop any already-picked files so they don't sneak
  // through on save.
  useEffect(() => {
    if (canStageMedia || stagedMedia.length === 0) return;
    for (const item of stagedMedia) URL.revokeObjectURL(item.previewUrl);
    setStagedMedia([]);
    setMediaUploadErrors([]);
  }, [canStageMedia, stagedMedia]);

  const runUploads: MediaStagingApi["runUploads"] = async ({
    targetShowId,
    targetShowPerformers,
    createUploadIntent,
    completeUpload,
  }) => {
    if (stagedMedia.length === 0) return { ok: true, errors: [] };

    // Map performer names (used in staging) → performer ids.
    const nameToPerformerId = new Map<string, string>();
    for (const sp of targetShowPerformers) {
      if (sp?.performer?.name && sp.performer.id) {
        nameToPerformerId.set(sp.performer.name, sp.performer.id);
      }
    }

    const errors: string[] = [];
    for (let i = 0; i < stagedMedia.length; i++) {
      const item = stagedMedia[i]!;
      setMediaUploadStatus(`Uploading ${i + 1} of ${stagedMedia.length}: ${item.file.name}`);
      const performerIds = item.performerNames
        .map((name) => nameToPerformerId.get(name))
        .filter((id): id is string => Boolean(id));
      try {
        const opts = {
          showId: targetShowId,
          file: item.file,
          performerIds: performerIds.length > 0 ? performerIds : undefined,
          createIntent: createUploadIntent,
          completeUpload,
        };
        if (item.kind === "photo") {
          await uploadPhotoForShow(opts);
        } else {
          await uploadVideoForShow(opts);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        errors.push(`${item.file.name}: ${msg}`);
      }
    }
    setMediaUploadStatus(null);
    if (errors.length > 0) {
      setMediaUploadErrors(errors);
      return { ok: false, errors };
    }
    return { ok: true, errors: [] };
  };

  return {
    stagedMedia,
    setStagedMedia,
    mediaUploadStatus,
    setMediaUploadStatus,
    mediaUploadErrors,
    setMediaUploadErrors,
    runUploads,
  };
}

interface MediaUploadSectionProps {
  media: MediaStagingApi;
  lineupNames: string[];
  disabled: boolean;
}

export function MediaUploadSection({ media, lineupNames, disabled }: MediaUploadSectionProps) {
  const router = useRouter();
  const { stagedMedia, setStagedMedia, mediaUploadStatus, mediaUploadErrors } = media;

  return (
    <>
      <AddShowMediaStaging
        staged={stagedMedia}
        onChange={setStagedMedia}
        disabled={disabled || Boolean(mediaUploadStatus)}
        lineupNames={lineupNames}
      />
      {mediaUploadStatus && (
        <div
          data-testid="add-show-media-status"
          style={{ marginTop: 8, fontFamily: mono, fontSize: 12, color: "var(--muted)" }}
        >
          {mediaUploadStatus}…
        </div>
      )}
      {mediaUploadErrors.length > 0 && (
        <div
          data-testid="add-show-media-errors"
          style={{ marginTop: 8, fontFamily: mono, fontSize: 12, color: "#E63946" }}
        >
          <div>Some uploads failed; the show was saved.</div>
          <ul style={{ margin: "4px 0 0 16px" }}>
            {mediaUploadErrors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => router.push(`/home`)}
            style={{
              marginTop: 6,
              background: "transparent",
              border: "1px solid var(--rule-strong)",
              padding: "4px 8px",
              fontFamily: mono,
              fontSize: 11,
              cursor: "pointer",
              color: "var(--ink)",
            }}
          >
            Go home
          </button>
        </div>
      )}
    </>
  );
}
