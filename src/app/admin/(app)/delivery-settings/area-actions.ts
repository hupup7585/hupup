"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { QUOTE_WHY, deliveryQuote, reloadDeliveryMap, savedAreas } from "@/lib/delivery-areas";
import { parseMoneyToCents } from "@/lib/money";

const back = (m: string) => redirect(`/admin/delivery-settings?m=${encodeURIComponent(m)}#areas`);

/** Owner only: names and prices of the delivery areas (the shapes stay as drawn on the Google map). Audited. */
export async function saveAreasAction(form: FormData) {
  const owner = await requireOwner();
  const areas = savedAreas((await getSettings()).deliveryAreas);
  const before = areas.map((a) => ({ id: a.id, name: a.name, priceCents: a.priceCents }));
  for (const a of areas) {
    const name = String(form.get(`name:${a.id}`) ?? "").trim();
    const price = String(form.get(`price:${a.id}`) ?? "").trim();
    if (name) a.name = name.slice(0, 80);
    a.priceCents = price === "" ? null : parseMoneyToCents(price);
    if (price !== "" && a.priceCents === null) return back(`The price for ${a.name} must be an amount, for example 15.00.`);
  }
  await saveSetting("deliveryAreas", JSON.stringify(areas), owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.delivery_areas_updated", entityType: "settings", entityId: "delivery_areas", before, after: areas.map((a) => ({ id: a.id, name: a.name, priceCents: a.priceCents })) });
  revalidatePath("/admin/delivery-settings");
  return back("Saved. New bookings use these prices.");
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
