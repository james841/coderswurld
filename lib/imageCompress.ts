/**
 * Shrink a photo in the browser before it is uploaded.
 *
 * WHY IT HAPPENS ON THE DEVICE
 * ----------------------------
 * A phone camera produces a 3-8 MB file. On a shop's mobile data that is a
 * 40-second upload that often fails halfway, and across thousands of businesses
 * it is a storage bill. Shrinking it *before* it leaves the phone means the
 * upload is ~200 KB: it goes through on a weak signal and costs almost nothing
 * to keep.
 *
 * WHY THE QUALITY SURVIVES
 * ------------------------
 * A phone photo is 4000px wide; no screen shows that, and a receipt's small
 * print is still crisp at 1800px. Most of the saving comes from dropping pixels
 * nobody can see, not from blurring the ones they can. WebP then stores what is
 * left about 30% smaller than JPEG at the same look. Quality is stepped down
 * only as far as needed to reach the target, never further.
 *
 * Browser-only: this file uses `document` and must be called from an event
 * handler in a client component, never during render.
 */

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  /** Size of the file the user picked, for the "3.4 MB → 180 KB" line. */
  originalBytes: number;
}

export interface CompressOptions {
  /** Longest side of the result, in pixels. */
  maxEdge?: number;
  /** Stop lowering quality once the file is at or under this size. */
  targetBytes?: number;
}

/** A receipt needs readable small print. These are tuned for that. */
export const RECEIPT_IMAGE: Required<CompressOptions> = {
  maxEdge: 1800,
  targetBytes: 260_000,
};

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: Blob): Promise<Decoded> {
  // createImageBitmap honours the photo's rotation tag, so a receipt shot in
  // portrait doesn't come out sideways.
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the <img> path — some browsers reject formats here that
      // they can still decode the long way.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode failed"));
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("This photo can't be opened. Try a JPG or PNG, or take it again.");
  }
}

function draw(decoded: Decoded, maxEdge: number): HTMLCanvasElement {
  const scale = Math.min(1, maxEdge / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't process images.");
  // White behind transparent PNGs, so a screenshot of an e-receipt doesn't turn
  // black when it is saved without an alpha channel.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(decoded.source, 0, 0, width, height);
  return canvas;
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * WebP where the browser can write it, JPEG where it can't. A browser that
 * doesn't support WebP encoding silently returns a PNG instead, which is far
 * larger — so the returned type is checked, not assumed.
 */
async function encodeBest(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  const webp = await encode(canvas, "image/webp", quality);
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode(canvas, "image/jpeg", quality);
  if (jpeg) return jpeg;
  throw new Error("This browser can't process images.");
}

export async function compressImage(
  file: Blob,
  options: CompressOptions = RECEIPT_IMAGE,
): Promise<CompressedImage> {
  const maxEdge = options.maxEdge ?? RECEIPT_IMAGE.maxEdge;
  const targetBytes = options.targetBytes ?? RECEIPT_IMAGE.targetBytes;

  const decoded = await decode(file);
  try {
    let best: { blob: Blob; canvas: HTMLCanvasElement } | null = null;

    // First pass at full target size, easing quality down. If a very busy photo
    // is still over target, a second pass trades some pixels instead of turning
    // the quality down into visible blockiness.
    const passes: { edge: number; qualities: number[] }[] = [
      { edge: maxEdge, qualities: [0.82, 0.74, 0.66] },
      { edge: Math.round(maxEdge * 0.78), qualities: [0.72, 0.62] },
    ];

    outer: for (const pass of passes) {
      const canvas = draw(decoded, pass.edge);
      for (const quality of pass.qualities) {
        const blob = await encodeBest(canvas, quality);
        if (!best || blob.size < best.blob.size) best = { blob, canvas };
        if (blob.size <= targetBytes) break outer;
      }
    }

    if (!best) throw new Error("This browser can't process images.");

    // A small, already-efficient file (a WhatsApp-forwarded photo, a screenshot)
    // can come out *bigger* after re-encoding. Keep the original when it wins.
    const reusable = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    if (reusable && file.size <= best.blob.size && file.size <= targetBytes * 1.5) {
      return {
        blob: file,
        width: decoded.width,
        height: decoded.height,
        originalBytes: file.size,
      };
    }

    return {
      blob: best.blob,
      width: best.canvas.width,
      height: best.canvas.height,
      originalBytes: file.size,
    };
  } finally {
    decoded.release();
  }
}

/**
 * A small preview for lists and grids, so a page of 24 receipts loads ~400 KB
 * of pictures instead of 5 MB. Returns null rather than throwing — a missing
 * thumbnail should never stop a receipt being filed.
 */
export async function makeThumbnail(file: Blob, edge = 420): Promise<Blob | null> {
  try {
    const decoded = await decode(file);
    try {
      const canvas = draw(decoded, edge);
      return await encodeBest(canvas, 0.7);
    } finally {
      decoded.release();
    }
  } catch {
    return null;
  }
}

/** "3.4 MB", "180 KB" */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}
