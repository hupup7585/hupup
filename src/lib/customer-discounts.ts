import { sql } from "drizzle-orm";
import { toE164 } from "@/lib/phone";

/**
 * Customer discounts (Abraham, Nov 17-18, 2026):
 *  - for a specific customer, by phone number; dollars off or percent off the rentals;
 *  - before sales tax (the tax is on the lower amount);
 *  - website and Admin only: the phone reads the total with the discount and never mentions it;
 *  - stays on every booking until the Owner turns it off, with an optional end date (the last day it counts);
 *  - never combined with an offer: the one that saves the customer more applies.
 */
export type DiscountRow = { kind: string; amount_cents: number | null; percent: string | number | null; note: string; ends_on: string | null };
type Exec = { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> };

/** The customer's discount in force today for this booking's phone, or null. */
export async function discountForOrder(exec: Exec, orderId: number, today: string): Promise<DiscountRow | null> {
  const r = await exec.execute(sql`
    SELECT d.kind, d.amount_cents, d.percent, d.note, d.ends_on::text AS ends_on
    FROM orders o JOIN customers c ON c.id = o.customer_id
    JOIN customer_discounts d ON d.phone = c.phone
    WHERE o.id = ${orderId} AND d.active AND (d.ends_on IS NULL OR d.ends_on >= ${today}::date)
    ORDER BY d.id DESC LIMIT 1`);
  return (r.rows[0] as DiscountRow | undefined) ?? null;
}

/** The money off the rentals: dollars (never more than the rentals) or a percent, rounded to the cent. */
export function discountCents(d: Pick<DiscountRow, "kind" | "amount_cents" | "percent">, rentalsCents: number): number {
  if (rentalsCents <= 0) return 0;
  if (d.kind === "percent") return Math.min(rentalsCents, Math.round((rentalsCents * Number(d.percent ?? 0)) / 100));
  return Math.min(rentalsCents, Math.max(0, Number(d.amount_cents ?? 0)));
}

/** "Customer discount: 10% off" / "Customer discount: $25.00 off" (Admin only). */
export function discountNote(d: Pick<DiscountRow, "kind" | "amount_cents" | "percent">): string {
  return d.kind === "percent" ? `Customer discount: ${Number(d.percent)}% off` : `Customer discount: $${(Number(d.amount_cents ?? 0) / 100).toFixed(2)} off`;
}

export type NewDiscount = { phone: string; kind: "amount" | "percent"; amountCents: number | null; percent: number | null; endsOn: string | null; note: string };

/** Admin form values to a discount, or the reason it can't be saved. */
export function parseDiscountForm(f: { phone: string; kind: string; value: string; endsOn: string; note: string }): NewDiscount | { error: string } {
  const phone = toE164(f.phone);
  if (!phone) return { error: "Enter the customer's 10-digit phone number." };
  const v = Number(String(f.value).replace(/[$,%\s]/g, ""));
  if (f.kind === "percent") {
    if (!(v > 0 && v <= 100)) return { error: "A percent must be more than 0 and at most 100." };
    return { phone, kind: "percent", amountCents: null, percent: Math.round(v * 100) / 100, endsOn: f.endsOn || null, note: f.note.trim().slice(0, 200) };
  }
  if (!(v > 0 && v <= 100000)) return { error: "Enter the dollars off, for example 25." };
  if (f.endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(f.endsOn)) return { error: "The end date is not a date." };
  return { phone, kind: "amount", amountCents: Math.round(v * 100), percent: null, endsOn: f.endsOn || null, note: f.note.trim().slice(0, 200) };
}
