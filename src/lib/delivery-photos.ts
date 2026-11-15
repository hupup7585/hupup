import { desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, schema } from "@/lib/db";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { PHOTO_MAX_BYTES, R2_STOP_BYTES, R2_WARN_BYTES, r2Put, r2Used } from "@/lib/r2";

/** Delivery and pickup photos (Abraham, Nov 15, 2026). JPEG, PNG or WebP; the phone shrinks them before upload. */
export function photoKind(head: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "image/png";
  if (head.length >= 12 && String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

export async function saveDeliveryPhoto(orderId: number, stop: "delivery" | "pickup", data: Uint8Array, by: { userId: number | null; name: string | null }) {
  if (!data.length || data.length > PHOTO_MAX_BYTES) throw new Error("Keep each photo under 4 MB.");
  const kind = photoKind(data.subarray(0, 16));
  if (!kind) throw new Error("That file isn't a photo (JPEG, PNG or WebP).");
  const used = await r2Used();
  if (used + data.length > R2_STOP_BYTES) throw new Error("Photo storage is almost at the free limit, so new photos are paused. The Owner was told.");
  const ext = kind === "image/jpeg" ? "jpg" : kind === "image/png" ? "png" : "webp";
  const key = `orders/${orderId}/${stop}/${new Date().toISOString().slice(0, 10)}-${randomUUID()}.${ext}`;
  await r2Put(key, data, kind);
  const [row] = await db
    .insert(schema.deliveryPhotos)
    .values({ orderId, stop, storageKey: key, contentType: kind, sizeBytes: data.length, takenBy: by.userId, takenByName: by.name })
    .returning();
  // A warning before anything could cost money: once, when the total first passes 8 GB
  if (used < R2_WARN_BYTES && used + data.length >= R2_WARN_BYTES && config.adminEmail())
    await sendEmail(config.adminEmail(), "Hup Up Attractions: photo storage at 8 GB", `Delivery photos now use 8 GB of the free 10 GB in Cloudflare R2. New photos stop at 9 GB, so nothing is ever charged. Please tell Claude what to do with older photos.\n\n${config.baseUrl()}/admin/deliveries`).catch(() => null);
  return row;
}

export async function photosFor(orderId: number) {
  return db.select().from(schema.deliveryPhotos).where(eq(schema.deliveryPhotos.orderId, orderId)).orderBy(desc(schema.deliveryPhotos.createdAt));
}
