import { randomBytes } from "node:crypto";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { PICTURE_MAX_BYTES } from "@/lib/promo-text";

/**
 * Promo pictures (Abraham, all-in-one, section 7). The browser turns each picture into a JPG about 1080 px wide at
 * the highest quality that fits about 500 KB; this file stores it, and keeps the full-size original (sent in pieces,
 * because Vercel takes at most 4.5 MB per request) for the website and Rentals page.
 */
export type PromoPicture = typeof schema.promoPictures.$inferSelect;

export const ORIGINAL_TYPES = ["image/jpeg", "image/jpg", "image/png"] as const;
/** Pieces of the original: 3 MB each, under Vercel's request limit. */
export const ORIGINAL_CHUNK_BYTES = 3 * 1024 * 1024;
/** Full-size phone photos are welcome; this only stops something that isn't a photo at all. */
export const ORIGINAL_MAX_BYTES = 60 * 1024 * 1024;

const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** Public link Twilio fetches for the MMS (unguessable token). */
export const pictureUrl = (token: string) => `${config.baseUrl()}/api/media/promo/${token}.jpg`;

export async function savePromoPicture(input: {
  jpg: Buffer;
  width: number;
  height: number;
  source: "upload" | "catalog";
  productId?: number | null;
  fileName?: string | null;
  originalType?: string | null;
  originalBytes?: number | null;
  userId: number | null;
}): Promise<PromoPicture> {
  if (!isJpeg(input.jpg)) throw new Error("That picture couldn't be converted to JPG. Try another photo.");
  if (input.jpg.length > PICTURE_MAX_BYTES) throw new Error("That picture is still too big after shrinking. Try another photo.");
  if (input.source === "upload") {
    const t = (input.originalType ?? "").toLowerCase();
    if (!ORIGINAL_TYPES.includes(t as (typeof ORIGINAL_TYPES)[number])) throw new Error("Use a JPG, JPEG or PNG picture.");
    if (!input.originalBytes || input.originalBytes > ORIGINAL_MAX_BYTES) throw new Error("That file is too big to be a photo.");
  }
  const [p] = await db
    .insert(schema.promoPictures)
    .values({
      token: randomBytes(18).toString("base64url"),
      source: input.source,
      productId: input.productId ?? null,
      fileName: input.fileName?.slice(0, 200) ?? null,
      jpg: input.jpg,
      jpgBytes: input.jpg.length,
      width: Math.round(input.width) || null,
      height: Math.round(input.height) || null,
      originalType: input.originalType ?? null,
      originalBytes: input.originalBytes ?? null,
      // A catalog photo's original is the catalog photo itself, already kept.
      originalComplete: input.source === "catalog",
      createdBy: input.userId,
    })
    .returning();
  await db.insert(schema.auditLog).values({ userId: input.userId, action: "promo_picture.saved", entityType: "promo_picture", entityId: String(p.id), after: { source: p.source, productId: p.productId, jpgBytes: p.jpgBytes, originalBytes: p.originalBytes } });
  return p;
}

/** One piece of the full-size original. The last piece marks the original complete when every byte arrived. */
export async function saveOriginalChunk(pictureId: number, idx: number, data: Buffer, last: boolean): Promise<{ complete: boolean }> {
  const [p] = await db.select({ originalBytes: schema.promoPictures.originalBytes, source: schema.promoPictures.source }).from(schema.promoPictures).where(eq(schema.promoPictures.id, pictureId)).limit(1);
  if (!p || p.source !== "upload") throw new Error("Picture not found.");
  if (idx < 0 || data.length === 0 || data.length > ORIGINAL_CHUNK_BYTES) throw new Error("That piece of the photo didn't arrive correctly.");
  await db.insert(schema.promoPictureChunks).values({ pictureId, idx, data }).onConflictDoNothing();
  if (!last) return { complete: false };
  const chunks = await db.select({ data: schema.promoPictureChunks.data }).from(schema.promoPictureChunks).where(eq(schema.promoPictureChunks.pictureId, pictureId));
  const total = chunks.reduce((n, c) => n + c.data.length, 0);
  const complete = total === p.originalBytes;
  if (complete) await db.update(schema.promoPictures).set({ originalComplete: true }).where(eq(schema.promoPictures.id, pictureId));
  return { complete };
}

/** The full-size original, put back together (Owner download). */
export async function originalOf(pictureId: number): Promise<{ type: string; data: Buffer } | null> {
  const [p] = await db.select().from(schema.promoPictures).where(eq(schema.promoPictures.id, pictureId)).limit(1);
  if (!p || p.source !== "upload" || !p.originalComplete) return null;
  const chunks = await db.select().from(schema.promoPictureChunks).where(eq(schema.promoPictureChunks.pictureId, pictureId)).orderBy(asc(schema.promoPictureChunks.idx));
  return { type: p.originalType === "image/png" ? "image/png" : "image/jpeg", data: Buffer.concat(chunks.map((c) => c.data)) };
}

export async function picturesByIds(ids: number[]): Promise<Omit<PromoPicture, "jpg">[]> {
  if (!ids.length) return [];
  const rows = await db
    .select({
      id: schema.promoPictures.id,
      token: schema.promoPictures.token,
      source: schema.promoPictures.source,
      productId: schema.promoPictures.productId,
      fileName: schema.promoPictures.fileName,
      jpgBytes: schema.promoPictures.jpgBytes,
      width: schema.promoPictures.width,
      height: schema.promoPictures.height,
      originalType: schema.promoPictures.originalType,
      originalBytes: schema.promoPictures.originalBytes,
      originalComplete: schema.promoPictures.originalComplete,
      createdBy: schema.promoPictures.createdBy,
      createdAt: schema.promoPictures.createdAt,
    })
    .from(schema.promoPictures)
    .where(inArray(schema.promoPictures.id, ids));
  return ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
}
