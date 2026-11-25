"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/** Owner: the two payment-link holds (Abraham, Nov 25, 2026: kept separate, phone 10 and Admin 25). Audited. */
export async function saveLinkHoldsAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const phone = Math.floor(Number(form.get("phone")));
  const admin = Math.floor(Number(form.get("admin")));
  if (!(phone >= 1 && phone <= 240) || !(admin >= 1 && admin <= 240)) return { ok: false, message: "Not saved. Each time must be a number of minutes from 1 to 240." };
  try {
    const s = await getSettings();
    await saveSetting("phoneLinkHoldMinutes", String(phone), owner.userId);
    await saveSetting("adminLinkHoldMinutes", String(admin), owner.userId);
    await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.link_holds_updated", entityType: "settings", entityId: "link_holds", before: { phone: s.phoneLinkHoldMinutes, admin: s.adminLinkHoldMinutes }, after: { phone, admin } });
    revalidatePath("/admin/settings");
    return { ok: true, message: "Saved" };
  } catch {
    return { ok: false, message: "Not saved. Please try again." };
  }
}
