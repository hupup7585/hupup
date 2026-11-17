"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/** Offers on/off switches (Owner only, audited). Its own page in the side menu (Abraham, Nov 17, 2026). */
export async function saveOffersAction(fd: FormData) {
  const owner = await requireOwner();
  const s = await getSettings();
  const after = {
    offerLaserThirdPackOn: fd.get("offerLaserThirdPackOn") === "on",
    offerThuSunOn: fd.get("offerThuSunOn") === "on",
    offerFourthSundayOn: fd.get("offerFourthSundayOn") === "on",
  };
  const before = { offerLaserThirdPackOn: s.offerLaserThirdPackOn, offerThuSunOn: s.offerThuSunOn, offerFourthSundayOn: s.offerFourthSundayOn };
  for (const [k, v] of Object.entries(after)) await saveSetting(k as keyof typeof after, v, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.offers_updated", entityType: "settings", entityId: "offers", before, after });
  revalidatePath("/admin", "layout");
  redirect(`/admin/offers?ok=${encodeURIComponent("Offers saved. They apply to new bookings.")}`);
}
