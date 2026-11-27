"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { parseMoneyToCents } from "@/lib/money";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function done(msg: string, isError = false): never {
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  redirect(`/admin/catalog?${isError ? "error" : "ok"}=${encodeURIComponent(msg)}`);
}

export async function saveCategoryAction(fd: FormData) {
  await requireOwner();
  const id = Number(fd.get("id") || 0);
  const name = s(fd, "name");
  if (!name) done("Category name is required", true);
  const digitRaw = s(fd, "ivrDigit");
  const ivrDigit = digitRaw ? Number(digitRaw) : null;
  if (ivrDigit !== null && !(ivrDigit >= 1 && ivrDigit <= 8)) done("Phone key must be 1-8 (9 = cart, 0 = operator)", true);
  if (ivrDigit !== null) {
    const clash = await db
      .select()
      .from(schema.categories)
      .where(id ? and(eq(schema.categories.ivrDigit, ivrDigit), ne(schema.categories.id, id)) : eq(schema.categories.ivrDigit, ivrDigit));
    if (clash.length) done(`Phone key ${ivrDigit} is already used by "${clash[0].name}"`, true);
  }
  const values = {
    name,
    spokenName: s(fd, "spokenName") || name.replace(/&/g, "and"),
    description: s(fd, "description"),
    // The old category emoji field is no longer shown or edited (no emoji, Abraham); the stored value is kept
    // The photo is set by Upload photo (never by saving this form, so a new upload is not overwritten)
    ivrDigit,
    sortOrder: Number(fd.get("sortOrder") || 0),
    active: fd.get("active") === "on",
  };
  if (id) await db.update(schema.categories).set(values).where(eq(schema.categories.id, id));
  else await db.insert(schema.categories).values(values);
  done(id ? "Category saved" : "Category added");
}

export async function saveProductAction(fd: FormData) {
  await requireOwner();
  const id = Number(fd.get("id") || 0);
  const name = s(fd, "name");
  const priceCents = parseMoneyToCents(s(fd, "price"));
  const quantity = Number(fd.get("quantity"));
  const categoryId = Number(fd.get("categoryId"));
  if (!name || priceCents === null || !Number.isInteger(quantity) || quantity < 0 || !categoryId) {
    done("Name, category, price and units owned are required", true);
  }
  const values = {
    name,
    categoryId,
    priceCents: priceCents!,
    quantity,
    description: s(fd, "description"),
    spokenDescription: s(fd, "spokenDescription"),
    dimensions: s(fd, "dimensions").slice(0, 120),
    sortOrder: Number(fd.get("sortOrder") || 0),
    sizeOrder: (() => {
      const n = Number(fd.get("sizeOrder"));
      return String(fd.get("sizeOrder") ?? "").trim() && Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
    })(),
    active: fd.get("active") === "on",
  };
  const [was] = id ? await db.select({ priceCents: schema.products.priceCents, sizeOrder: schema.products.sizeOrder, categoryId: schema.products.categoryId }).from(schema.products).where(eq(schema.products.id, id)) : [];
  if (id) await db.update(schema.products).set(values).where(eq(schema.products.id, id));
  else await db.insert(schema.products).values(values);
  // A price spoken inside recordings (ocean balls, Nov 27, 2026): changed = those recordings are flagged
  if (was && was.priceCents !== values.priceCents) {
    const [cat] = await db.select({ name: schema.categories.name }).from(schema.categories).where(eq(schema.categories.id, values.categoryId));
    if (cat) await (await import("@/lib/recording-flags")).linkedValueChanged(`product:${cat.name}:${values.sizeOrder ?? was.sizeOrder ?? ""}`, was.priceCents, values.priceCents);
  }
  done(id ? "Item saved" : "Item added");
}

/**
 * A real photo upload for an item or a category (Abraham, Nov 17, 2026): JPEG, PNG or WebP up to 4 MB (the browser
 * shrinks big phone photos first), kept in Cloudflare R2 and shown on the website through /api/catalog-photo/.
 */
export async function uploadCatalogPhotoAction(fd: FormData): Promise<{ ok: boolean; message: string }> {
  await requireOwner();
  const k = String(fd.get("kind"));
  const kind = k === "category" ? "categories" : k === "text" ? "text" : "products";
  const id = Number(fd.get("id"));
  const file = fd.get("photo") as File | null;
  if (!id || !file || typeof file === "string") return { ok: false, message: "Choose a photo first." };
  // Deep check B6: checked before anything is stored, so a refused picture never takes up storage
  if (kind === "text" && id !== 1 && id !== 2) return { ok: false, message: "Choose picture 1 or picture 2." };
  // Deep check 06:00 M69 (B6 leftover): the item or category must exist before its photo is stored
  if (kind !== "text") {
    const table = kind === "categories" ? schema.categories : schema.products;
    const [found] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
    if (!found) return { ok: false, message: "That item was not found. Reload the page and try again." };
  }
  const data = new Uint8Array(await file.arrayBuffer());
  const { photoKind } = await import("@/lib/delivery-photos");
  const { PHOTO_MAX_BYTES, r2Put } = await import("@/lib/r2");
  const type = photoKind(data.subarray(0, 16));
  if (!type) return { ok: false, message: "That file isn't a photo. Use a JPG, PNG or WebP picture." };
  if (data.length > PHOTO_MAX_BYTES) return { ok: false, message: "Keep the photo under 4 MB." };
  const { randomUUID } = await import("node:crypto");
  const key = `catalog/${kind}/${id}-${randomUUID()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
  try {
    await r2Put(key, data, type);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const imageUrl = `/api/catalog-photo/${key}`;
  if (kind === "text") {
    // Catalog by text, picture 1 or 2 (Abraham, Nov 17, 2026; checked above)
    const { saveSetting } = await import("@/lib/settings");
    await saveSetting(id === 1 ? "catalogTextPicture1" : "catalogTextPicture2", imageUrl);
  } else if (kind === "categories") await db.update(schema.categories).set({ imageUrl }).where(eq(schema.categories.id, id));
  else await db.update(schema.products).set({ imageUrl }).where(eq(schema.products.id, id));
  revalidatePath("/admin", "layout");
  revalidatePath("/");
  return { ok: true, message: "Photo saved." };
}

/** Owner only: put an item in Garbage (off the catalog list, website and phone menu) or restore it. Audited. */
export async function trashProductAction(fd: FormData) {
  const owner = await requireOwner();
  const id = Number(fd.get("id"));
  const restore = fd.get("restore") === "1";
  if (!id) done("Item not found", true);
  await db.update(schema.products).set(restore ? { trashedAt: null, active: true } : { trashedAt: new Date(), active: false }).where(eq(schema.products.id, id));
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: restore ? "catalog.item_restored" : "catalog.item_to_garbage", entityType: "product", entityId: String(id) });
  done(restore ? "Item restored: it's back on the catalog list, website and phone menu." : "Item moved to Garbage. You can restore it from the Garbage list.");
}

