import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, todayISO } from "@/lib/dates";
import { checkBookable } from "@/lib/availability";
import { checkEventDate } from "@/lib/jewish-calendar";
import { getSettings } from "@/lib/settings";

/*
 * Nearest options when an item is booked (shared by the phone line, key 1, and the expired payment link page):
 * the next size up or down in the same category that's free that day, or the same item on the day before / after
 * (else the nearest open days before and after).
 */
type Cal = Awaited<ReturnType<typeof getSettings>>;
type P = { id: number; quantity: number; categoryId: number; sizeOrder: number | null };

/** Active items of a category in menu order (the phone offers up to 9: keypad 1-9). */
export async function categoryProducts(categoryId: number) {
  return db
    .select()
    .from(schema.products)
    .where(and(eq(schema.products.categoryId, categoryId), eq(schema.products.active, true)))
    .orderBy(asc(schema.products.sortOrder), asc(schema.products.id));
}

export async function itemFreeOn(p: { id: number; quantity: number }, date: string, cal: Cal): Promise<boolean> {
  if (date < todayISO()) return false;
  if (!checkEventDate(date, cal).ok) return false;
  return (await checkBookable(p.id, p.quantity, date)) > 0;
}

/** Next size up (+1) or down (-1) in the same category that's free that day; null if none. */
export async function nearestSize(p: P, date: string, dir: 1 | -1, cal: Cal) {
  if (p.sizeOrder == null) return null;
  const sizes = (await categoryProducts(p.categoryId))
    .slice(0, 9)
    .filter((x) => x.id !== p.id && x.sizeOrder != null && (dir > 0 ? x.sizeOrder! > p.sizeOrder! : x.sizeOrder! < p.sizeOrder!))
    .sort((a, b) => dir * (a.sizeOrder! - b.sizeOrder!));
  for (const x of sizes) if (await itemFreeOn(x, date, cal)) return x;
  return null;
}

/** Nearest open day with the item free, searching back (-1) or forward (+1) from a date (skipping closed days). */
export async function nearestFreeDay(p: { id: number; quantity: number }, date: string, dir: 1 | -1, cal: Cal, start = 2, limit = dir > 0 ? 90 : 60) {
  for (let i = start; i <= limit; i++) {
    const d = addDays(date, dir * i);
    if (dir < 0 && d < todayISO()) return null;
    if (await itemFreeOn(p, d, cal)) return d;
  }
  return null;
}

/** Same item on another day: the day before and after if free, else the nearest open days before and after. */
export async function nearbyDays(p: { id: number; quantity: number }, date: string, cal: Cal): Promise<{ near: boolean; before: string | null; after: string | null }> {
  const b = addDays(date, -1);
  const a = addDays(date, 1);
  const [okB, okA] = await Promise.all([itemFreeOn(p, b, cal), itemFreeOn(p, a, cal)]);
  if (okB || okA) return { near: true, before: okB ? b : null, after: okA ? a : null };
  const [before, after] = await Promise.all([nearestFreeDay(p, date, -1, cal), nearestFreeDay(p, date, 1, cal)]);
  return { near: false, before, after };
}
