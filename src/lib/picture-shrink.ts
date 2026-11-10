import { PICTURE_TARGET_BYTES, PICTURE_WIDTH } from "@/lib/promo-text";

/**
 * Browser only. Turns any JPG/PNG (full-size phone photos too) into a JPG about 1080 px wide, keeping its shape, at
 * the highest quality that fits about 500 KB (Abraham, section 7d). Transparent PNG areas become white.
 */
export type Shrunk = { blob: Blob; width: number; height: number; quality: number };

const toBlob = (c: HTMLCanvasElement, q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't convert the picture."))), "image/jpeg", q));

export async function shrinkToPhoneJpg(input: Blob, target = PICTURE_TARGET_BYTES, maxWidth = PICTURE_WIDTH): Promise<Shrunk> {
  const bmp = await createImageBitmap(input, { imageOrientation: "from-image" });
  let width = Math.min(maxWidth, bmp.width);
  for (let round = 0; round < 6; round++) {
    const height = Math.round((bmp.height * width) / bmp.width);
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, width, height);
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, 0, 0, width, height);
    // Highest quality that fits: binary search between 0.5 and 0.95.
    let lo = 0.5, hi = 0.95, best: Blob | null = null, bestQ = 0;
    const top = await toBlob(c, hi);
    if (top.size <= target) return { blob: top, width, height, quality: hi };
    for (let i = 0; i < 7; i++) {
      const q = (lo + hi) / 2;
      const b = await toBlob(c, q);
      if (b.size <= target) {
        best = b;
        bestQ = q;
        lo = q;
      } else hi = q;
    }
    if (best) return { blob: best, width, height, quality: bestQ };
    width = Math.round(width * 0.85); // still too big at the lowest quality: a little narrower
  }
  throw new Error("This picture couldn't be made small enough. Try another photo.");
}

export const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
