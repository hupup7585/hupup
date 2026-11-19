import { and, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Website catalog request (Abraham, Nov 18, 2026, approved): "Or text CATALOG to (845) 415-7585." and an
 * "Email me the catalog" box. Shown on the preview site until Abraham approves the screenshot.
 */
export const WEBSITE_CATALOG_FORM_LIVE_APPROVED = true; // Abraham approved the card, Nov 19, 2026
export const websiteCatalogFormShown = (env: Record<string, string | undefined> = process.env) => WEBSITE_CATALOG_FORM_LIVE_APPROVED || env.VERCEL_ENV !== "production";

export { CATALOG_TEXT_LINE, CATALOG_EMAIL_BUTTON, CATALOG_TEXT_BUTTON, CATALOG_FORM_DRAFT } from "@/lib/catalog-request-copy";

export const validCatalogEmail = (e: string) => /^[^@\s<>,;]+@[^@\s<>,;]+\.[^@\s<>,;]{2,}$/.test(e.trim()) && e.trim().length <= 200;

/** Once per email address per day (from the audit log of catalog sends). */
export async function catalogEmailedToday(email: string, now = new Date()): Promise<boolean> {
  const rows = await db
    .select({ id: schema.auditLog.id })
    .from(schema.auditLog)
    .where(and(eq(schema.auditLog.action, "catalog.website_request"), eq(schema.auditLog.entityId, email.toLowerCase()), gte(schema.auditLog.createdAt, new Date(now.getTime() - 24 * 3600_000))))
    .limit(1);
  return rows.length > 0;
}
