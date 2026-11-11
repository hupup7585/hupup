import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, PUBLIC_PHONE_DISPLAY, config } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { toE164 } from "@/lib/phone";

/**
 * Key 8 catalog (Abraham, Nov 11, 2026): the caller picks email or text. Built from the Admin catalog (active
 * categories and items, in Admin order). Requesting the catalog never signs anyone up for promo texts.
 *
 * "owner_test": only the Owner's own phone hears the key 8 steps (proposed wording, waiting for Abraham's approval);
 * other callers who press 8 go to customer service. "live": everyone.
 */
export type CatalogPhoneMode = "owner_test" | "live";
export const CATALOG_PHONE_MODE: CatalogPhoneMode = "owner_test";

export function catalogStepsOn(callerFrom: string | null | undefined, mode: CatalogPhoneMode = CATALOG_PHONE_MODE, env: Record<string, string | undefined> = process.env): boolean {
  if (mode === "live") return true;
  const caller = toE164(callerFrom);
  return Boolean(caller && caller === (toE164(env.ADMIN_PHONE) ?? "+18457777585"));
}

export async function catalogLines() {
  const cats = await db.select().from(schema.categories).where(eq(schema.categories.active, true)).orderBy(asc(schema.categories.ivrDigit), asc(schema.categories.id));
  const out: { category: string; items: { name: string; description: string }[] }[] = [];
  for (const c of cats) {
    const items = await db
      .select({ name: schema.products.name, description: schema.products.description })
      .from(schema.products)
      .where(and(eq(schema.products.categoryId, c.id), eq(schema.products.active, true)))
      .orderBy(asc(schema.products.id));
    if (items.length) out.push({ category: c.name, items });
  }
  return out;
}

/** The catalog email (proposed wording, sent only on the Owner's test calls until approved). */
export async function catalogEmail() {
  const base = config.baseUrl();
  const lines = await catalogLines();
  const text = [
    `Thank you for your interest in ${BUSINESS_NAME}!`,
    "",
    "Here is our catalog:",
    ...lines.flatMap((c) => ["", c.category, ...c.items.map((i) => `- ${i.name}${i.description ? `: ${i.description}` : ""}`)]),
    "",
    `See photos of our rentals: ${base}/#rentals`,
    `To book, call ${PUBLIC_PHONE_DISPLAY}.`,
  ].join("\n");
  return { subject: `${BUSINESS_NAME} catalog`, text };
}

export async function sendCatalogEmail(to: string) {
  const { subject, text } = await catalogEmail();
  return sendEmail(to, subject, text);
}

/** The catalog text (proposed wording): a short line with the Rentals page link. Sent only once texting is approved. */
export const catalogText = () => `${BUSINESS_NAME}: Here is our catalog: ${config.baseUrl()}/#rentals To book, call ${PUBLIC_PHONE_DISPLAY}.`;
