import { and, asc, eq, ilike, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Laser tag choices with prices on the website (Abraham, Nov 17, 2026: "list the laser tag choices with prices").
 * Draft wording: shown on preview only until Abraham approves the wording and the screenshot.
 */
export const LASER_LIST_LIVE_APPROVED = false;

export const LASER_LIST_COPY = {
  heading: "Choices and prices",
  addOnsLine: (six: string, four: string) => `Need more players? Add more laser guns to any maze or laser gun choice: a 6-pack for ${six} or a 4-pack for ${four}.`,
} as const;

export function laserListShown(env: Record<string, string | undefined> = process.env): boolean {
  return LASER_LIST_LIVE_APPROVED || env.VERCEL_ENV !== "production";
}

export type LaserPriceList = { choices: { name: string; priceCents: number }[]; addOns: { name: string; priceCents: number }[] };

/** The live laser tag items (active, not in Garbage) in their catalog order, plus the two add-on packs. */
export async function laserPriceList(): Promise<LaserPriceList | null> {
  try {
    const rows = async (cat: string) =>
      db
        .select({ name: schema.products.name, priceCents: schema.products.priceCents })
        .from(schema.products)
        .innerJoin(schema.categories, eq(schema.categories.id, schema.products.categoryId))
        .where(and(ilike(schema.categories.name, cat), eq(schema.products.active, true), isNull(schema.products.trashedAt)))
        .orderBy(asc(schema.products.sizeOrder), asc(schema.products.id));
    const choices = await rows("Laser Tag and Inflatable Mazes");
    const addOns = await rows("Laser tag add-ons");
    return choices.length ? { choices, addOns } : null;
  } catch (e) {
    console.error("laser price list", e);
    return null;
  }
}

export const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`);
