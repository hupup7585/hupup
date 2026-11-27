"use server";

import { revalidatePath } from "next/cache";
import { msgQuery } from "@/lib/url-message";
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
  redirect(`/admin/offers?${msgQuery("Offers saved. They apply to new bookings.", "ok")}`);
}

/** Chanukah and Chol Hamoed rentals (Abraham, Nov 18, 2026): switches and numbers, Owner only, audited. */
export async function saveHolidayRentalsAction(fd: FormData) {
  const owner = await requireOwner();
  const s = await getSettings();
  // Extra check F8 (Nov 27, 2026): a blank box keeps the saved value (it used to save 0); a number out of range is
  // refused with a message and nothing is saved (it used to be swapped for the default while saying "saved")
  const cur = s as Record<string, unknown>;
  const bad: string[] = [];
  const num = (k: string, min: number, max: number, d: string) => {
    const raw = String(fd.get(k) ?? "").trim();
    if (raw === "") return String(cur[k] ?? d);
    const v = Number(raw);
    if (Number.isFinite(v) && v >= min && v <= max) return String(v);
    bad.push(`${raw} (allowed ${min} to ${max})`);
    return String(cur[k] ?? d);
  };
  const timeRaw = String(fd.get("holidaySundayPickup") ?? "").trim();
  const time = timeRaw === "" ? String(cur.holidaySundayPickup ?? "09:00") : timeRaw;
  // Deep check 06:00 M69 (F8 leftover): a real clock time only (00:00 to 23:59), never 25:99
  const realTime = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  if (!realTime(time)) bad.push(`${timeRaw} (a time like 09:00)`);
  const after = {
    holidayPerDayChanukah: fd.get("holidayPerDayChanukah") === "on",
    holidayPerDayCholHamoed: fd.get("holidayPerDayCholHamoed") === "on",
    holidayNoPromos: fd.get("holidayNoPromos") === "on",
    holidayPickupAfterShabbesMin: num("holidayPickupAfterShabbesMin", 0, 300, "60"),
    holidayMutzeDeliveryAfterMin: num("holidayMutzeDeliveryAfterMin", 0, 360, "150"),
    holidaySundayPickup: realTime(time) ? time : "09:00",
    holidayFridayMutzeDays: num("holidayFridayMutzeDays", 1, 3, "1.5"),
    holidayMutzeAloneDays: num("holidayMutzeAloneDays", 0.5, 3, "1"),
  };
  if (bad.length) redirect(`/admin/offers?${msgQuery(`Not saved: ${bad.join(", ")}. Nothing was changed.`)}`);
  const before = Object.fromEntries(Object.keys(after).map((k) => [k, (s as Record<string, unknown>)[k]]));
  for (const [k, v] of Object.entries(after)) await saveSetting(k as keyof typeof after, v as never, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.holiday_rentals", entityType: "settings", entityId: "holiday_rentals", before, after });
  revalidatePath("/admin", "layout");
  redirect(`/admin/offers?${msgQuery("Chanukah and Chol Hamoed settings saved. They apply to new bookings.", "ok")}`);
}


/** The Offers page intro line (Abraham, Nov 26, 2026): Owner only, audited; empty = the approved line. */
export async function saveOffersIntroAction(fd: FormData) {
  const owner = await requireOwner();
  const s = await getSettings();
  const text = String(fd.get("offersIntro") ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  await saveSetting("offersIntro", text || "Turn each offer on or off here. Customers only get the offers that are on.", owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.offers_intro_updated", entityType: "settings", entityId: "offers", before: { offersIntro: s.offersIntro }, after: { offersIntro: text } });
  revalidatePath("/admin/offers");
  redirect(`/admin/offers?${msgQuery("Saved.", "ok")}`);
}
