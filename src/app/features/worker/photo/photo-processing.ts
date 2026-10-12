/** Normalised rectangle (0..1 of the image) that is painted solid black before the photo is saved. */
export interface MaskRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ProcessedPhoto {
  readonly blob: Blob;
  readonly thumb: Blob;
  readonly width: number;
  readonly height: number;
}

/** Long side of the stored photo: enough to read a bolt head, small enough to sync on a weak signal. */
export const PHOTO_MAX_SIDE = 2048;
const THUMB_MAX_SIDE = 360;

/** Decodes a camera file with its EXIF orientation applied. Throws on formats the browser cannot read. */
export async function decodePhoto(file: Blob): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/') && file.type !== '') throw new Error(`Not an image: ${file.type}`);
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

/**
 * Re-encodes the photo through a canvas. Masks are burned into the pixels, and because only pixels are
 * copied, every piece of EXIF metadata (GPS position, device, owner) is left behind.
 */
export async function renderPhoto(bitmap: ImageBitmap, masks: readonly MaskRect[]): Promise<ProcessedPhoto> {
  const full = await drawToJpeg(bitmap, masks, PHOTO_MAX_SIDE, 0.82);
  const thumb = await drawToJpeg(bitmap, masks, THUMB_MAX_SIDE, 0.7);
  return { blob: full.blob, thumb: thumb.blob, width: full.width, height: full.height };
}

export function fitSize(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function paintMasks(ctx: CanvasRenderingContext2D, masks: readonly MaskRect[], width: number, height: number): void {
  ctx.fillStyle = '#000';
  for (const m of masks) ctx.fillRect(m.x * width, m.y * height, m.w * width, m.h * height);
}

async function drawToJpeg(bitmap: ImageBitmap, masks: readonly MaskRect[], maxSide: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitSize(bitmap.width, bitmap.height, maxSide);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  paintMasks(ctx, masks, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('JPEG encoding failed');
  return { blob, width, height };
}

/** Share of browser storage already used, or null where the browser does not say. */
export async function storagePressure(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.quota || est.usage === undefined) return null;
    return est.usage / est.quota;
  } catch {
    return null;
  }
}
