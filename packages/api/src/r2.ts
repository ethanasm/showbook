import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ---------------------------------------------------------------------------
// R2 client (S3-compatible)
// ---------------------------------------------------------------------------

let client: S3Client | null = null;

export function getR2Client(): S3Client {
  if (client) return client;

  const accountId = process.env.R2_ACCOUNT_ID;
  if (!accountId) throw new Error('R2_ACCOUNT_ID is not set');

  client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });

  return client;
}

// ---------------------------------------------------------------------------
// Upload a buffer directly to R2
// ---------------------------------------------------------------------------

export async function uploadToR2(
  key: string,
  body: Buffer,
  contentType: string
): Promise<void> {
  const s3 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME ?? 'showbook';

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

// ---------------------------------------------------------------------------
// Delete object from R2
// ---------------------------------------------------------------------------

export async function deleteFromR2(key: string): Promise<void> {
  const s3 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME ?? 'showbook';

  await s3.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
}

// ---------------------------------------------------------------------------
// Read object metadata from R2
// ---------------------------------------------------------------------------

export async function headFromR2(
  key: string
): Promise<{ bytes: number; contentType: string | null }> {
  const s3 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME ?? 'showbook';

  const response = await s3.send(
    new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );

  return {
    bytes: response.ContentLength ?? 0,
    contentType: response.ContentType ?? null,
  };
}

// ---------------------------------------------------------------------------
// Generate presigned upload URL (for direct client uploads, future use)
// ---------------------------------------------------------------------------

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600
): Promise<string> {
  const s3 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME ?? 'showbook';

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3, command, { expiresIn });
}

// ---------------------------------------------------------------------------
// Generate presigned read URL
// ---------------------------------------------------------------------------

export async function getPresignedReadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const s3 = getR2Client();
  const bucket = process.env.R2_BUCKET_NAME ?? 'showbook';

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn });
}

// ---------------------------------------------------------------------------
// Construct public URL from key
// ---------------------------------------------------------------------------

export function getPublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}
