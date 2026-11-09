"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

type State = { ok?: boolean; message?: string } | null;

/** "$10" / "10.00" -> "1000" cents; null if not a valid amount. */
function toCents(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  return String(Math.round(Number(s) * 100));
}
const places = (v: FormDataEntryValue | null) =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 100)
    .join("\n");

/** Owner only: delivery fees and the towns in each delivery zone. Audited. */
export async function saveDeliveryPricingAction(_prev: State, form: FormData): Promise<State> {
  const owner = await requireOwner();
  const kj = toCents(form.get("deliveryFeeKj"));
  const area = toCents(form.get("deliveryFeeArea"));
  if (kj === null || area === null) return { ok: false, message: "Enter each fee as dollars, like 10 or 15.00." };
  const zoneKj = places(form.get("zoneKjPlaces"));
  const zoneArea = places(form.get("zoneAreaPlaces"));
  if (!zoneKj) return { ok: false, message: "The Kiryas Joel zone needs at least one place." };
  const s = await getSettings();
  const before = { deliveryFeeKjCents: s.deliveryFeeKjCents, deliveryFeeAreaCents: s.deliveryFeeAreaCents, zoneKjPlaces: s.zoneKjPlaces, zoneAreaPlaces: s.zoneAreaPlaces };
  const after = { deliveryFeeKjCents: kj, deliveryFeeAreaCents: area, zoneKjPlaces: zoneKj, zoneAreaPlaces: zoneArea };
  for (const [k, v] of Object.entries(after)) await saveSetting(k as keyof typeof after, v, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.delivery_pricing_updated", entityType: "settings", entityId: "delivery_pricing", before, after });
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Saved. New bookings use these fees and zones." };
}

/** Owner only: the sales tax rate (business-wide). Audited. */
export async function saveSalesTaxAction(_prev: State, form: FormData): Promise<State> {
  const owner = await requireOwner();
  const v = String(form.get("salesTaxPercent") ?? "").replace(/[%\s]/g, "");
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(v) || Number(v) > 25) return { ok: false, message: "Enter the rate as a percent, like 8.125." };
  const before = (await getSettings()).salesTaxPercent;
  await saveSetting("salesTaxPercent", v, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.sales_tax_updated", entityType: "settings", entityId: "sales_tax", before: { salesTaxPercent: before }, after: { salesTaxPercent: v } });
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Saved. New bookings use this rate." };
}
