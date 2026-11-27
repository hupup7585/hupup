import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Website catalog request (Abraham, Nov 18, 2026, approved): "Or text CATALOG to (845) 415-7585." and an
 * "Email me the catalog" box. Shown on the preview site until Abraham approves the screenshot.
 */
export const WEBSITE_CATALOG_FORM_LIVE_APPROVED = true; // Abraham approved the card, Nov 19, 2026
export const websiteCatalogFormShown = (env: Record<string, string | undefined> = process.env) => WEBSITE_CATALOG_FORM_LIVE_APPROVED || env.VERCEL_ENV !== "production";
/** The card is shown and its two boxes work: approved (above) and switched on in Admin (website Phase W4, on to start). */
export async function catalogCardOn(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!websiteCatalogFormShown(env)) return false;
  const { getSettings } = await import("@/lib/settings");
  return (await getSettings()).siteCatalogCardOn !== false;
}

export { CATALOG_EMAIL_BUTTON, CATALOG_TEXT_BUTTON, CATALOG_FORM_DRAFT } from "@/lib/catalog-request-copy";

export const validCatalogEmail = (e: string) => /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]{2,}$/.test(e.trim()) && e.trim().length <= 200;

/** Once per email address per day (from the audit log of catalog sends). */
export async function catalogEmailedToday(email: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    // Extra check E4 (Nov 27, 2026): only a catalog that really went out counts; a failed try can be asked for again
    .where(and(eq(schema.auditLog.action, "catalog.website_request"), eq(schema.auditLog.entityId, email.toLowerCase()), gte(schema.auditLog.createdAt, new Date(now.getTime() - 24 * 3600_000)), sql`(${schema.auditLog.after}->>'sent') = 'true'`))
    .limit(1);
  return rows.length > 0;
}

/**
 * Abuse limit for the two website catalog boxes: at most this many catalog sends (email and text together) from one
 * internet address in 24 hours, so a robot cannot text or email the catalog to many numbers and addresses (each text
 * costs money). People asking once or twice never reach it.
 */
export const MAX_CATALOG_REQUESTS_PER_IP_PER_DAY = 10;
export const CATALOG_REQUEST_ACTIONS = ["catalog.website_request", "catalog.website_text_request"] as const;

/** True when this internet address already used up today's catalog sends (no address known: never limited). */
export async function catalogIpLimitReached(ip: string | null, now = new Date()): Promise<boolean> {
  if (!ip) return false;
  // website Phase W4: the number is an Admin setting (10 to start, as before)
  const { getSettings } = await import("@/lib/settings");
  const n = Math.round(Number((await getSettings()).siteCatalogSendsPerAddressPerDay));
  const limit = Number.isFinite(n) && n >= 1 && n <= 100 ? n : MAX_CATALOG_REQUESTS_PER_IP_PER_DAY;
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.auditLog)
    .where(and(inArray(schema.auditLog.action, [...CATALOG_REQUEST_ACTIONS]), eq(schema.auditLog.ip, ip), gte(schema.auditLog.createdAt, new Date(now.getTime() - 24 * 3600_000))));
  return Number(row?.n ?? 0) >= limit;
}

/** The visitor's internet address, or null outside a web request. */
export async function requestIp(): Promise<{ ip: string | null; userAgent: string | null; referer: string | null }> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    return {
      ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || h.get("x-real-ip") || null,
      userAgent: h.get("user-agent")?.slice(0, 500) || null,
      referer: h.get("referer")?.slice(0, 500) || null,
    };
  } catch {
    return { ip: null, userAgent: null, referer: null }; // outside a web request (tests)
  }
}
