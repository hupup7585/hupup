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
  const s = await getSettings();
  await saveSetting("catalogName", name, owner.userId);
  await saveSetting("catalogAutoAttach", auto, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.catalog_email", entityType: "settings", entityId: "catalog", before: { name: s.catalogName, auto: s.catalogAutoAttach }, after: { name, auto } });
  revalidatePath("/admin/catalog-send");
  return { ok: true, message: auto ? `Saved. Every catalog email carries the PDF${name ? ` and says "${name}" in the subject` : ""}.` : "Saved. Catalog emails go out without the PDF." };
}
