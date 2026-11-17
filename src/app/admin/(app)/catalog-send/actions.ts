"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/** The catalog's name (added to the email subject) and "attach automatically" (Abraham, Nov 17, 2026, item 13). */
export async function saveCatalogEmailAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const auto = form.get("auto") === "on";
  const { CATALOG_EMAIL_BODY_DEFAULT, CATALOG_EMAIL_SUBJECT_DEFAULT } = await import("@/lib/catalog-send");
  // Same as the approved wording = saved blank, so it keeps following the approved wording
  let subject = String(form.get("subject") ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  let body = String(form.get("body") ?? "").replace(/\r\n/g, "\n").trim().slice(0, 5000);
  if (form.get("reset") === "1" || subject === CATALOG_EMAIL_SUBJECT_DEFAULT) subject = "";
  if (form.get("reset") === "1" || body === CATALOG_EMAIL_BODY_DEFAULT) body = "";
  const s = await getSettings();
  await saveSetting("catalogName", name, owner.userId);
  await saveSetting("catalogAutoAttach", auto, owner.userId);
  await saveSetting("catalogEmailSubjectText", subject, owner.userId);
  await saveSetting("catalogEmailBodyText", body, owner.userId);
  await db.insert(schema.auditLog).values({
    userId: owner.userId,
    action: "settings.catalog_email",
    entityType: "settings",
    entityId: "catalog",
    before: { name: s.catalogName, auto: s.catalogAutoAttach, subject: s.catalogEmailSubjectText, body: s.catalogEmailBodyText },
    after: { name, auto, subject, body },
  });
  revalidatePath("/admin/catalog-send");
  return { ok: true, message: auto ? `Saved. Every catalog email carries the PDF${name ? ` and says "${name}" in the subject` : ""}.` : "Saved. Catalog emails go out without the PDF." };
}

/** One catalog photo for texts: checked, kept in R2, its address returned for the list (saved with Save). */
export async function uploadCatalogTextPhotoAction(fd: FormData): Promise<{ ok: boolean; message: string; url?: string }> {
  await requireOwner();
  const file = fd.get("photo") as File | null;
  if (!file || typeof file === "string") return { ok: false, message: "Choose a photo first." };
  const data = new Uint8Array(await file.arrayBuffer());
  const { photoKind } = await import("@/lib/delivery-photos");
  const { PHOTO_MAX_BYTES, r2Put } = await import("@/lib/r2");
  const type = photoKind(data.subarray(0, 16));
  if (!type) return { ok: false, message: "That file isn't a photo. Use a JPG, PNG or WebP picture." };
  if (data.length > PHOTO_MAX_BYTES) return { ok: false, message: "Keep the photo under 4 MB." };
  const { randomUUID } = await import("node:crypto");
  const key = `catalog/text/${randomUUID()}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
  try {
    await r2Put(key, data, type);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  return { ok: true, message: "Photo added.", url: `/api/catalog-photo/${key}` };
}

/** Save the photo catalog for texts (the order as shown); it replaces the one before. */
export async function saveCatalogTextItemsAction(items: { photo: string; text: string }[]): Promise<{ ok: boolean; message: string }> {
  const owner = await requireOwner();
  const { parseCatalogTextItems } = await import("@/lib/catalog-send");
  const clean = parseCatalogTextItems(JSON.stringify(items));
  if (clean.length !== items.length) return { ok: false, message: "Every row needs a photo (up to 10 rows)." };
  if (items.some((i) => i.text.length > 1500)) return { ok: false, message: "Keep each text under 1,500 characters." };
  await saveSetting("catalogTextItems", JSON.stringify(clean), owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.catalog_text_items", entityType: "settings", entityId: "catalogTextItems", after: { count: clean.length } });
  revalidatePath("/admin/catalog-send");
  return { ok: true, message: clean.length ? `Saved. A catalog by text now sends ${clean.length} message${clean.length === 1 ? "" : "s"}, in this order.` : "Saved. No photos: the catalog by text sends the words only." };
}
