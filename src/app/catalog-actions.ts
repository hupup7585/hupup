"use server";

import { db, schema } from "@/lib/db";
import { CATALOG_FORM_DRAFT, catalogEmailedToday, validCatalogEmail, websiteCatalogFormShown } from "@/lib/catalog-request";

/** "Email me the catalog" on the website: the real catalog email (PDF attached), once per address per day. */
export async function requestCatalogAction(_prev: { ok: boolean; message: string } | null, form: FormData): Promise<{ ok: boolean; message: string }> {
  if (!websiteCatalogFormShown()) return { ok: false, message: CATALOG_FORM_DRAFT.failed };
  if (String(form.get("website") ?? "")) return { ok: true, message: CATALOG_FORM_DRAFT.sent }; // a robot filled the hidden box
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!validCatalogEmail(email)) return { ok: false, message: CATALOG_FORM_DRAFT.bad };
  if (await catalogEmailedToday(email)) return { ok: true, message: CATALOG_FORM_DRAFT.again };
  const { sendCatalogEmail, recordCatalogRequest } = await import("@/lib/catalog-send");
  const r = await sendCatalogEmail(email).catch(() => ({ sent: false }));
  await db.insert(schema.auditLog).values({ action: "catalog.website_request", entityType: "email", entityId: email, after: { sent: r.sent } });
  await recordCatalogRequest({ callerPhone: null, channel: "email", to: email, sent: r.sent, source: "email" }).catch(() => null);
  return r.sent ? { ok: true, message: CATALOG_FORM_DRAFT.sent } : { ok: false, message: CATALOG_FORM_DRAFT.failed };
}
