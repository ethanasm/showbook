"use client";

import { useEffect, useRef } from "react";
import { ImagePlus, Trash2, Video } from "lucide-react";
import "./media.css";

export type StagedMediaItem = {
  id: string;
  file: File;
  kind: "photo" | "video";
  previewUrl: string;
  performerNames: string[];
};

const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";
const VIDEO_ACCEPT = "video/mp4";

function classify(file: File): "photo" | "video" | null {
  if (file.type.startsWith("image/")) return "photo";
  if (file.type.startsWith("video/")) return "video";
  const name = file.name.toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif")) return "photo";
  return null;
}

function isHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === "image/heic" || type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

async function heicPreviewUrl(file: File): Promise<string> {
  const { heicTo } = await import("heic-to");
  const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.7 });
  return URL.createObjectURL(blob);
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function AddShowMediaStaging({
  staged,
  onChange,
  disabled,
  lineupNames = [],
}: {
  staged: StagedMediaItem[];
  onChange: (next: StagedMediaItem[]) => void;
  disabled?: boolean;
  lineupNames?: string[];
}) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const stagedRef = useRef(staged);
  stagedRef.current = staged;

  useEffect(() => {
    return () => {
      for (const item of stagedRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, []);

  function addFiles(files: FileList | File[]) {
    const defaultPerformerNames =
      lineupNames.length === 1 && lineupNames[0] ? [lineupNames[0]] : [];
    const next: StagedMediaItem[] = [];
    const heicJobs: { id: string; file: File }[] = [];
    for (const file of Array.from(files)) {
      const kind = classify(file);
      if (!kind) continue;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const heic = kind === "photo" && isHeic(file);
      next.push({
        id,
        file,
        kind,
        previewUrl: heic ? "" : URL.createObjectURL(file),
        performerNames: defaultPerformerNames,
      });
      if (heic) heicJobs.push({ id, file });
    }
    if (next.length === 0) return;
    onChange([...staged, ...next]);

    for (const job of heicJobs) {
      heicPreviewUrl(job.file)
        .then((url) => {
          const current = stagedRef.current;
          if (!current.some((s) => s.id === job.id)) {
            URL.revokeObjectURL(url);
            return;
          }
          onChange(
            current.map((s) => (s.id === job.id ? { ...s, previewUrl: url } : s)),
          );
        })
        .catch(() => {
          // leave previewUrl empty; img will show broken icon, item still uploads
        });
    }
  }

  function togglePerformer(id: string, name: string) {
    onChange(
      staged.map((s) => {
        if (s.id !== id) return s;
        const has = s.performerNames.includes(name);
        return {
          ...s,
          performerNames: has
            ? s.performerNames.filter((n) => n !== name)
            : [...s.performerNames, name],
        };
      }),
    );
  }

  function removeItem(id: string) {
    const item = staged.find((s) => s.id === id);
    if (item) URL.revokeObjectURL(item.previewUrl);
    onChange(staged.filter((s) => s.id !== id));
  }

  return (
    <div data-testid="add-show-media-staging">
      <div className="media-uploader">
        <div>
          <div className="media-uploader__title">Photos & videos</div>
          <div className="media-uploader__meta">
            Optional. Files upload after the show is saved. JPEG/PNG/HEIC photos and MP4 videos.
          </div>
        </div>
        <div className="media-uploader__actions">
          <button
            type="button"
            className="media-button media-button--primary"
            disabled={disabled}
            onClick={() => photoInputRef.current?.click()}
          >
            <ImagePlus size={14} /> Photo
          </button>
          <button
            type="button"
            className="media-button"
            disabled={disabled}
            onClick={() => videoInputRef.current?.click()}
          >
            <Video size={14} /> Video
          </button>
          <input
            ref={photoInputRef}
            className="media-file-input"
            data-testid="add-show-photo-input"
            type="file"
            multiple
            accept={PHOTO_ACCEPT}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              if (photoInputRef.current) photoInputRef.current.value = "";
            }}
          />
          <input
            ref={videoInputRef}
            className="media-file-input"
            data-testid="add-show-video-input"
            type="file"
            multiple
            accept={VIDEO_ACCEPT}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              if (videoInputRef.current) videoInputRef.current.value = "";
            }}
          />
        </div>
      </div>

      {staged.length > 0 && (
        <div
          data-testid="add-show-staged-list"
          style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}
        >
          {staged.map((item) => (
            <div
              key={item.id}
              style={{
                border: "1px solid var(--rule)",
                padding: "8px 10px",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span
                  className="media-card__label"
                  title={item.file.name}
                  style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {item.file.name} · {formatBytes(item.file.size)}
                </span>
                <button
                  type="button"
                  className="media-card__delete"
                  aria-label="Remove media"
                  onClick={() => removeItem(item.id)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
              {lineupNames.length > 1 && (
                <div
                  data-testid="add-show-staged-tags"
                  style={{ display: "flex", flexWrap: "wrap", gap: 4 }}
                >
                  {lineupNames.map((name) => {
                    const checked = item.performerNames.includes(name);
                    return (
                      <button
                        key={name}
                        type="button"
                        className={
                          checked ? "media-tag" : "media-tag media-tag--button"
                        }
                        onClick={() => togglePerformer(item.id, name)}
                      >
                        {checked ? "✓ " : "+ "}{name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StagedMediaPreview({ staged }: { staged: StagedMediaItem[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
      {staged.slice(0, 6).map((item) => (
        <div
          key={item.id}
          style={{
            aspectRatio: "4/3",
            border: "1px solid var(--rule)",
            background: "var(--surface2)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {item.kind === "photo" ? (
            item.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.previewUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <div style={{ fontFamily: "var(--font-geist-mono), monospace", fontSize: 10, color: "var(--faint)" }}>
                Decoding…
              </div>
            )
          ) : (
            <video
              src={item.previewUrl}
              muted
              preload="metadata"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
