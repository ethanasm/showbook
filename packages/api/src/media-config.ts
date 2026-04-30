const DEFAULTS = {
  globalQuotaBytes: 8_589_934_592,
  userQuotaBytes: 1_073_741_824,
  showQuotaBytes: 314_572_800,
  photoMaxSourceBytes: 20_971_520,
  photoMaxStoredBytes: 5_242_880,
  videoMaxBytes: 157_286_400,
  showMaxPhotos: 30,
  showMaxVideos: 2,
  uploadUrlTtlSeconds: 900,
  readUrlTtlSeconds: 3600,
  allowedImageTypes: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
  allowedVideoTypes: 'video/mp4',
  storageMode: 'r2',
};

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function readList(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function getMediaConfig() {
  const storageMode = (process.env.MEDIA_STORAGE_MODE ?? DEFAULTS.storageMode).toLowerCase();

  return {
    storageMode,
    globalQuotaBytes: readInt('MEDIA_GLOBAL_QUOTA_BYTES', DEFAULTS.globalQuotaBytes),
    userQuotaBytes: readInt('MEDIA_USER_QUOTA_BYTES', DEFAULTS.userQuotaBytes),
    showQuotaBytes: readInt('MEDIA_SHOW_QUOTA_BYTES', DEFAULTS.showQuotaBytes),
    photoMaxSourceBytes: readInt(
      'MEDIA_PHOTO_MAX_SOURCE_BYTES',
      DEFAULTS.photoMaxSourceBytes,
    ),
    photoMaxStoredBytes: readInt(
      'MEDIA_PHOTO_MAX_STORED_BYTES',
      DEFAULTS.photoMaxStoredBytes,
    ),
    videoMaxBytes: readInt('MEDIA_VIDEO_MAX_BYTES', DEFAULTS.videoMaxBytes),
    showMaxPhotos: readInt('MEDIA_SHOW_MAX_PHOTOS', DEFAULTS.showMaxPhotos),
    showMaxVideos: readInt('MEDIA_SHOW_MAX_VIDEOS', DEFAULTS.showMaxVideos),
    uploadUrlTtlSeconds: readInt(
      'MEDIA_UPLOAD_URL_TTL_SECONDS',
      DEFAULTS.uploadUrlTtlSeconds,
    ),
    readUrlTtlSeconds: readInt(
      'MEDIA_READ_URL_TTL_SECONDS',
      DEFAULTS.readUrlTtlSeconds,
    ),
    allowedImageTypes: readList(
      'MEDIA_ALLOWED_IMAGE_TYPES',
      DEFAULTS.allowedImageTypes,
    ),
    allowedVideoTypes: readList(
      'MEDIA_ALLOWED_VIDEO_TYPES',
      DEFAULTS.allowedVideoTypes,
    ),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
