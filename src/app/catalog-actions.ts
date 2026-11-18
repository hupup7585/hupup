"use server";

import { eq } from "drizzle-orm";
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

/**
 * "Text me the catalog" on the website (Abraham, Nov 18, 2026): the same catalog texts as key 8 and texting CATALOG
 * (the first text, then each photo), once per number per day, never after STOP; from the hotline number only.
 */
export async function textCatalogAction(_prev: { ok: boolean; message: string } | null, form: FormData): Promise<{ ok: boolean; message: string }> {
  if (!websiteCatalogFormShown()) return { ok: false, message: CATALOG_FORM_DRAFT.failed };
  if (String(form.get("website") ?? "")) return { ok: true, message: CATALOG_FORM_DRAFT.textSent };
  const { toE164 } = await import("@/lib/phone");
  const digits = String(form.get("phone") ?? "").replace(/\D/g, "");
  const phone = digits.length === 10 || (digits.length === 11 && digits.startsWith("1")) ? toE164(digits) : null;
  if (!phone) return { ok: false, message: CATALOG_FORM_DRAFT.badPhone };
  const { replyToCatalogText } = await import("@/lib/catalog-send");
  const { sendMessage } = await import("@/lib/sms");
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  const r = await replyToCatalogText(phone, {
    optedOut: Boolean(c?.smsOptOut),
    send: (to, body, media) => sendMessage({ to, body, ...(media?.length ? { mediaUrls: media } : {}), kind: "system", event: "catalog_reply", customerId: c?.id }),
  }).catch(() => ({ replied: false, reason: "send_failed" as const }));
  await db.insert(schema.auditLog).values({ action: "catalog.website_text_request", entityType: "phone", entityId: phone, after: r });
  if (r.replied) return { ok: true, message: CATALOG_FORM_DRAFT.textSent };
  if (r.reason === "already_today") return { ok: true, message: CATALOG_FORM_DRAFT.textAgain };
  return { ok: false, message: CATALOG_FORM_DRAFT.failed };
}

