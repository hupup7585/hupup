"use server";

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CATALOG_FORM_DRAFT, catalogEmailedToday, catalogIpLimitReached, requestIp, validCatalogEmail, websiteCatalogFormShown } from "@/lib/catalog-request";

/** "Email me the catalog" on the website: the real catalog email (PDF attached), once per address per day. */
export async function requestCatalogAction(_prev: { ok: boolean; message: string } | null, form: FormData): Promise<{ ok: boolean; message: string }> {
  if (!websiteCatalogFormShown()) return { ok: false, message: CATALOG_FORM_DRAFT.failed };
  if (String(form.get("website") ?? "")) return { ok: true, message: CATALOG_FORM_DRAFT.sent }; // a robot filled the hidden box
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!validCatalogEmail(email)) return { ok: false, message: CATALOG_FORM_DRAFT.bad };
  if (await catalogEmailedToday(email)) return { ok: true, message: CATALOG_FORM_DRAFT.again };
  // One internet address: at most 10 catalog sends a day (robots), with the usual "could not send" line
  const req = await requestIp();
  if (await catalogIpLimitReached(req.ip)) {
    await db.insert(schema.auditLog).values({ action: "catalog.website_limit", entityType: "email", entityId: email, ip: req.ip, after: { reason: "ip_daily_limit" } });
    return { ok: false, message: CATALOG_FORM_DRAFT.failed };
  }
  const { sendCatalogEmail, recordCatalogRequest } = await import("@/lib/catalog-send");
  const r = await sendCatalogEmail(email).catch(() => ({ sent: false }));
  await db.insert(schema.auditLog).values({ action: "catalog.website_request", entityType: "email", entityId: email, ip: req.ip, userAgent: req.userAgent, after: { sent: r.sent } });
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
  // Plan A (Abraham, Nov 27, 2026, 1:52 AM): nothing is sent unless the consent box was ticked
  const { CATALOG_TEXT_CONSENT, CATALOG_TEXT_CONSENT_VERSION, CATALOG_TEXT_DRAFT } = await import("@/lib/catalog-request-copy");
  const draftOk = process.env.VERCEL_ENV !== "production"; // unapproved lines show on preview only
  if (String(form.get("consent") ?? "") !== "yes") return { ok: false, message: draftOk ? CATALOG_TEXT_DRAFT.noConsent : CATALOG_FORM_DRAFT.failed };
  const { replyToCatalogText } = await import("@/lib/catalog-send");
  const { sendMessage } = await import("@/lib/sms");
  const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  // A number that replied STOP gets nothing (and no consent record: only START and YES lift a STOP)
  if (c?.smsOptOut) {
    await db.insert(schema.auditLog).values({ action: "catalog.website_text_request", entityType: "phone", entityId: phone, after: { replied: false, reason: "opted_out" } });
    return { ok: false, message: draftOk ? CATALOG_TEXT_DRAFT.stopped : CATALOG_FORM_DRAFT.failed };
  }
  // One internet address: at most 10 catalog sends a day (robots), before any consent record or text
  const req = await requestIp();
  if (await catalogIpLimitReached(req.ip)) {
    await db.insert(schema.auditLog).values({ action: "catalog.website_limit", entityType: "phone", entityId: phone, ip: req.ip, after: { reason: "ip_daily_limit" } });
    return { ok: false, message: CATALOG_FORM_DRAFT.failed };
  }
  // The consent record: number, time, page, the exact box wording and the IP
  await db.insert(schema.smsConsents).values({
    customerId: c?.id ?? null,
    phone,
    scope: "catalog", // a one-time catalog text: not order texts, not promotions
    action: "opt_in",
    source: "web",
    method: "checkbox",
    wording: CATALOG_TEXT_CONSENT,
    wordingVersion: CATALOG_TEXT_CONSENT_VERSION,
    response: "checked",
    ip: req.ip,
    userAgent: req.userAgent,
    pageUrl: req.referer,
  });
  const r = await replyToCatalogText(phone, {
    optedOut: false,
    send: (to, body, media) => sendMessage({ to, body, ...(media?.length ? { mediaUrls: media } : {}), kind: "system", event: "catalog_reply", customerId: c?.id }),
  }).catch(() => ({ replied: false, reason: "send_failed" as const }));
  await db.insert(schema.auditLog).values({ action: "catalog.website_text_request", entityType: "phone", entityId: phone, ip: req.ip, userAgent: req.userAgent, after: r });
  if (r.replied) return { ok: true, message: CATALOG_FORM_DRAFT.textSent };
  if (r.reason === "already_today") return { ok: true, message: CATALOG_FORM_DRAFT.textAgain };
  return { ok: false, message: CATALOG_FORM_DRAFT.failed };
}

