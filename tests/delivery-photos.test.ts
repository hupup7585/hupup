import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Delivery photos in Cloudflare R2 (Abraham, Nov 15, 2026). In-memory database; R2 replaced by a stand-in. */
const h = vi.hoisted(() => ({ stored: new Map<string, Uint8Array>(), emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async (_to: string, subject: string) => (h.emails.push(subject), { sent: true }), sendSms: async () => ({ sent: true }) }));
vi.mock("@/lib/r2", async (orig) => ({
  ...(await orig<typeof import("@/lib/r2")>()),
  r2Put: async (key: string, data: Uint8Array) => void h.stored.set(key, data),
}));

import { db, schema } from "@/lib/db";
import { photoKind, saveDeliveryPhoto } from "@/lib/delivery-photos";
import { PHOTO_MAX_BYTES } from "@/lib/r2";

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(200).fill(1)]);

describe("delivery photos", () => {
  it("a JPEG is stored privately in R2 under the order and stop, with who took it", async () => {
    const p = await saveDeliveryPhoto(1438, "delivery", jpeg, { userId: 5, name: "Dovid" });
    expect(p.storageKey).toMatch(/^orders\/1438\/delivery\/\d{4}-\d{2}-\d{2}-[0-9a-f-]+\.jpg$/);
    expect(h.stored.get(p.storageKey)).toEqual(jpeg);
    expect(p).toMatchObject({ orderId: 1438, stop: "delivery", contentType: "image/jpeg", sizeBytes: jpeg.length, takenBy: 5, takenByName: "Dovid" });
  });
  it("only photos, and only up to 4 MB", async () => {
    expect(photoKind(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    await expect(saveDeliveryPhoto(1, "pickup", new TextEncoder().encode("%PDF-1.7 not a photo"), { userId: null, name: null })).rejects.toThrow("isn't a photo");
    await expect(saveDeliveryPhoto(1, "pickup", new Uint8Array(PHOTO_MAX_BYTES + 1), { userId: null, name: null })).rejects.toThrow("under 4 MB");
  });
  it("stays in the free tier: new photos pause at 9 GB", async () => {
    await db.insert(schema.deliveryPhotos).values({ orderId: 2, stop: "delivery", storageKey: "x", contentType: "image/jpeg", sizeBytes: 2_000_000_000 });
    await db.insert(schema.deliveryPhotos).values({ orderId: 2, stop: "delivery", storageKey: "y", contentType: "image/jpeg", sizeBytes: 2_000_000_000 });
    await db.insert(schema.deliveryPhotos).values({ orderId: 2, stop: "delivery", storageKey: "z", contentType: "image/jpeg", sizeBytes: 2_000_000_000 });
    await db.insert(schema.deliveryPhotos).values({ orderId: 2, stop: "delivery", storageKey: "w", contentType: "image/jpeg", sizeBytes: 2_000_000_000 });
    await db.insert(schema.deliveryPhotos).values({ orderId: 2, stop: "delivery", storageKey: "v", contentType: "image/jpeg", sizeBytes: 1_700_000_000 });
    await expect(saveDeliveryPhoto(3, "delivery", jpeg, { userId: null, name: null })).rejects.toThrow("free limit");
  });
  it("the stop card has a working Add photo button; photos open only for signed-in staff", () => {
    const ui = readFileSync("src/app/admin/deliveries/StopActions.tsx", "utf8");
    expect(ui).toContain('capture="environment"');
    expect(ui).toContain("uploadPhotoAction");
    const route = readFileSync("src/app/api/admin/photos/[id]/route.ts", "utf8");
    expect(route).toContain('return new Response("Unauthorized", { status: 401 })');
    expect(route).toContain("hasAnyStop(full.order, staff.userId)");
  });
});
