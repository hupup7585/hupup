"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/** Owner only: the stock / warehouse address the delivery run starts from and returns to. Audited. */
export async function saveStockAddressAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const value = String(form.get("stockAddress") || "").replace(/\s+/g, " ").trim();
  if (value.length > 200) return { ok: false, message: "That address is too long (200 characters at most)." };
  if (value && !/[a-z]/i.test(value)) return { ok: false, message: "Please enter a street address, like 51 Forest Road, Monroe, NY 10950." };
  const before = (await getSettings()).stockAddress;
  await saveSetting("stockAddress", value, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.stock_address_updated", entityType: "settings", entityId: "stock_address", before: { stockAddress: before }, after: { stockAddress: value } });
  revalidatePath("/admin/settings");
  revalidatePath("/admin/deliveries");
  return { ok: true, message: value ? "Saved." : "Cleared. Routes will start from the driver's location." };
}
