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

/** Owner: "Speed for spoken names" (Abraham, Nov 25, 2026, 12:36). 1.0 = normal, 1.1 = 10 percent faster. Audited. */
export async function saveNameSpeedAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const rate = Number(String(form.get("rate") ?? "").replace(",", "."));
  if (!(rate >= 0.5 && rate <= 2)) return { ok: false, message: "Not saved. Use a number from 0.5 to 2 (1.1 is 10 percent faster)." };
  try {
    const before = (await getSettings()).nameSpeakingRate;
    await saveSetting("nameSpeakingRate", String(Math.round(rate * 100) / 100), owner.userId);
    await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.name_speed_updated", entityType: "settings", entityId: "name_speaking_rate", before: { rate: before }, after: { rate } });
    revalidatePath("/admin/settings");
    return { ok: true, message: "Saved" };
  } catch {
    return { ok: false, message: "Not saved. Please try again." };
  }
}
