import sharp from 'sharp';

export interface ProcessedImage {
  thumb: Buffer; // 200px wide
  card: Buffer; // 600px wide
  full: Buffer; // original resolution
}

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  const thumb = await sharp(input)
    .resize(200, null, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const card = await sharp(input)
    .resize(600, null, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();

  const full = await sharp(input).webp({ quality: 90 }).toBuffer();

  return { thumb, card, full };
}
