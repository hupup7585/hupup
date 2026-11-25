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
    laserThirdSetHalfOn: fd.get("laserThirdSetHalfOn") === "on",
    offerThuSunOn: fd.get("offerThuSunOn") === "on",
    offerFourthSundayOn: fd.get("offerFourthSundayOn") === "on",
  };
  const before = { laserThirdSetHalfOn: s.laserThirdSetHalfOn, offerThuSunOn: s.offerThuSunOn, offerFourthSundayOn: s.offerFourthSundayOn };
  for (const [k, v] of Object.entries(after)) await saveSetting(k as keyof typeof after, v, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.offers_updated", entityType: "settings", entityId: "offers", before, after });
  revalidatePath("/admin", "layout");
  redirect(`/admin/offers?ok=${encodeURIComponent("Offers saved. They apply to new bookings.")}`);
}

/** Chanukah and Chol Hamoed rentals (Abraham, Nov 18, 2026): switches and numbers, Owner only, audited. */
export async function saveHolidayRentalsAction(fd: FormData) {
  const owner = await requireOwner();
  const s = await getSettings();
  const num = (k: string, min: number, max: number, d: string) => {
    const v = Number(fd.get(k));
    return Number.isFinite(v) && v >= min && v <= max ? String(v) : d;
  };
  const time = String(fd.get("holidaySundayPickup") ?? "");
  const after = {
    holidayPerDayChanukah: fd.get("holidayPerDayChanukah") === "on",
    holidayPerDayCholHamoed: fd.get("holidayPerDayCholHamoed") === "on",
    holidayNoPromos: fd.get("holidayNoPromos") === "on",
    holidayPickupAfterShabbesMin: num("holidayPickupAfterShabbesMin", 0, 300, "60"),
    holidayMutzeDeliveryAfterMin: num("holidayMutzeDeliveryAfterMin", 0, 360, "150"),
    holidaySundayPickup: /^\d{2}:\d{2}$/.test(time) ? time : "09:00",
    holidayFridayMutzeDays: num("holidayFridayMutzeDays", 1, 3, "1.5"),
    holidayMutzeAloneDays: num("holidayMutzeAloneDays", 0.5, 3, "1"),
  };
  const before = Object.fromEntries(Object.keys(after).map((k) => [k, (s as Record<string, unknown>)[k]]));
  for (const [k, v] of Object.entries(after)) await saveSetting(k as keyof typeof after, v as never, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.holiday_rentals", entityType: "settings", entityId: "holiday_rentals", before, after });
  revalidatePath("/admin", "layout");
  redirect(`/admin/offers?ok=${encodeURIComponent("Chanukah and Chol Hamoed settings saved. They apply to new bookings.")}`);
}

