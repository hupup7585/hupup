import type { Settings } from "@/lib/settings";

/**
 * Checkout pricing (Abram, 2026-11-05):
 *  - Delivery: $10 inside Kiryas Joel, $15 in the surrounding (Orange County) towns. Anything else is outside the
 *    delivery area: checkout stops and asks for an in-area address.
 *  - Sales tax: the delivery county's rate on the whole order including delivery. Orange County only (8.125%).
 *  - The payment link charges items + delivery + tax.
 * All values come from admin-editable settings.
 */

export type Zone = "kj" | "area" | "outside";

export type Totals = { subtotalCents: number; deliveryFeeCents: number; taxCents: number; totalCents: number; taxPercent: string; zone: Zone };

function places(list: string): string[] {
  return list
    .split(/\n|,/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
}

function normalize(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/** Which delivery zone an address is in, by town name (Kiryas Joel first, since it shares ZIP 10950 with Monroe). */
export function deliveryZone(address: string | null | undefined, s: Pick<Settings, "zoneKjPlaces" | "zoneAreaPlaces">): Zone {
  if (!address?.trim()) return "outside";
  const a = normalize(address);
  const has = (p: string) => a.includes(normalize(p));
  if (places(s.zoneKjPlaces).some(has)) return "kj";
  if (places(s.zoneAreaPlaces).some(has)) return "area";
  return "outside";
}

/** Tax in cents on an amount, with a percent like "8.125" (exact decimal math, rounded half up to the cent). */
export function taxOn(amountCents: number, percent: string): number {
  const [whole, frac = ""] = percent.trim().split(".");
  const scale = 10 ** frac.length;
  const rate = Number(whole) * scale + Number(frac || 0); // percent × scale
  return Math.round((amountCents * rate) / (100 * scale));
}

export function computeTotals(subtotalCents: number, zone: Zone, s: Pick<Settings, "deliveryFeeKjCents" | "deliveryFeeAreaCents" | "salesTaxPercent">): Totals | null {
  if (zone === "outside") return null;
  const deliveryFeeCents = Number(zone === "kj" ? s.deliveryFeeKjCents : s.deliveryFeeAreaCents) || 0;
  const taxCents = taxOn(subtotalCents + deliveryFeeCents, s.salesTaxPercent);
  return { subtotalCents, deliveryFeeCents, taxCents, totalCents: subtotalCents + deliveryFeeCents + taxCents, taxPercent: s.salesTaxPercent, zone };
}
