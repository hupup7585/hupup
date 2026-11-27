"use server";

import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { itemTypesToSave, parseItemTypes } from "@/lib/item-types";

export type TypesResult = { ok: boolean; message: string };

/**
 * Owner only (Admin handoff Phase 4, Nov 27, 2026): saves Catalog > Item types. Only choices that differ from what the
 * name already gives are kept, so "worked out from the name" stays the default. Audited with before and after.
 */
export async function saveItemTypesAction(form: FormData): Promise<TypesResult> {
  const me = await requireOwner();
  const cats = await db.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories);
  const prods = await db.select({ id: schema.products.id, name: schema.products.name, categoryId: schema.products.categoryId }).from(schema.products);
  const pick = (prefix: string) => Object.fromEntries([...form.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), String(v)]));
  const next = itemTypesToSave(cats, prods, pick("cat:"), pick("prod:"));
  const before = parseItemTypes((await getSettings() as { itemTypes?: unknown }).itemTypes);
  await saveSetting("itemTypes", JSON.stringify(next), me.userId ?? null);
  await db.insert(schema.auditLog).values({ userId: me.userId ?? null, action: "catalog.item_types_saved", entityType: "settings", entityId: "itemTypes", before, after: next });
  const { revalidatePath } = await import("next/cache");
  revalidatePath("/admin/catalog/types");
  revalidatePath("/admin/pos");
  const n = Object.keys(next.categories).length + Object.keys(next.products).length;
  return { ok: true, message: n ? `Saved. ${n} type${n === 1 ? " is" : "s are"} set by hand; everything else is worked out from the name.` : "Saved. Every type is worked out from the name." };
}
