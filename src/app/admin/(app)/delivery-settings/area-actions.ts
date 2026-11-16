"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { QUOTE_WHY, deliveryQuote, reloadDeliveryMap, savedAreas } from "@/lib/delivery-areas";

const back = (m: string) => redirect(`/admin/delivery-settings?m=${encodeURIComponent(m)}#areas`);

/** Owner only: names of the delivery areas (shapes from the Google map; prices follow Abraham's rule). Audited. */
export async function saveAreasAction(form: FormData) {
  const owner = await requireOwner();
  const areas = savedAreas((await getSettings()).deliveryAreas);
  const before = areas.map((a) => ({ id: a.id, name: a.name, priceCents: a.priceCents }));
  for (const a of areas) {
    const name = String(form.get(`name:${a.id}`) ?? "").trim();
    if (name) a.name = name.slice(0, 80);
  }
  await saveSetting("deliveryAreas", JSON.stringify(areas), owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.delivery_areas_updated", entityType: "settings", entityId: "delivery_areas", before, after: areas.map((a) => ({ id: a.id, name: a.name, priceCents: a.priceCents })) });
  revalidatePath("/admin/delivery-settings");
  return back("Saved.");
}

export async function reloadMapAction() {
  const owner = await requireOwner();
  const r = await reloadDeliveryMap();
  if (r.ok) await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.delivery_map_reloaded", entityType: "settings", entityId: "delivery_areas", after: { areas: r.areas?.map((a) => a.name) } });
  revalidatePath("/admin/delivery-settings");
  return back(r.message);
}

export async function checkAddressAction(form: FormData) {
  await requireOwner();
  const address = String(form.get("address") ?? "").trim();
  if (!address) return back("Type an address to check.");
  const q = await deliveryQuote(address, await getSettings());
  return back(q.ok ? `${address}: ${q.zone}, delivery $${(q.feeCents / 100).toFixed(2)}.` : `${address}: no price, because ${QUOTE_WHY[q.reason]}${"area" in q && q.area ? ` (${q.area})` : ""}.`);
}

/** "$10" / "10.00" -> cents; null if not a valid amount. */
function toCents(v: FormDataEntryValue | null): string | null {
  const t = String(v ?? "").replace(/[$,\s]/g, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  return String(Math.round(Number(t) * 100));
}
const isoDate = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : "";
};

/**
 * Owner only: the three zone prices (KJ, nearby towns, anywhere else in Orange County) and the free delivery promo
 * (Abraham, Nov 17, 2026). The phone line, New booking, the payment page and the payment total all use them. Audited.
 */
export async function saveZonePricesAction(form: FormData) {
  const owner = await requireOwner();
  const kj = toCents(form.get("kj"));
  const area = toCents(form.get("area"));
  const outside = toCents(form.get("outside"));
  if (kj === null || area === null || outside === null) return back("Enter each price as dollars, like 10 or 15.00.");
  const promoOn = form.get("promoOn") === "on";
  const start = isoDate(form.get("promoStart"));
  const end = isoDate(form.get("promoEnd"));
  if (start && end && end < start) return back("The promo end date is before its start date.");
  const s = await getSettings();
  const before = { deliveryFeeKjCents: s.deliveryFeeKjCents, deliveryFeeAreaCents: s.deliveryFeeAreaCents, deliveryFeeOutsideCents: s.deliveryFeeOutsideCents, deliveryPromoOn: s.deliveryPromoOn, deliveryPromoStart: s.deliveryPromoStart, deliveryPromoEnd: s.deliveryPromoEnd };
  const after = { deliveryFeeKjCents: kj, deliveryFeeAreaCents: area, deliveryFeeOutsideCents: outside, deliveryPromoOn: promoOn, deliveryPromoStart: start, deliveryPromoEnd: end };
  for (const [k, v] of Object.entries(after)) await saveSetting(k as keyof typeof after, v as never, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.delivery_zone_prices_updated", entityType: "settings", entityId: "delivery_zone_prices", before, after });
  revalidatePath("/admin", "layout");
  return back(promoOn ? "Saved. The free delivery promo is on for the dates shown." : "Saved.");
}
