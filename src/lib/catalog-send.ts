import { and, asc, eq, gte } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, PUBLIC_PHONE_DISPLAY, config } from "@/lib/config";
import { sendEmail, sendSms } from "@/lib/notify";
import { toE164 } from "@/lib/phone";
import { logStamp } from "@/lib/phone-promo";

/**
 * Key 8 catalog (Abraham, Phone Menu v3): by text (once Twilio approves texting) or by email, built from the Admin
 * catalog. Requesting the catalog never signs anyone up for promo texts. Every request is logged on the contact;
 * a failed send alerts Abraham.
 */

/**
 * The info@ "subject Catalog" auto-reply (section 9). Abraham approved the wording on Nov 13, 2026 (the key 8 catalog
 * email with his PDF). It runs once the Cloudflare Email Worker is connected (INBOUND_EMAIL_SECRET set in Vercel).
 */
export const infoCatalogAutoreplyOn = (env: Record<string, string | undefined> = process.env) => Boolean(env.INBOUND_EMAIL_SECRET || env.AUTH_SECRET);

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

/** The catalog email: subject "Hup Up Attractions catalog", categories and items from Admin, the Rentals link. */
export async function catalogEmail() {
  const lines = await catalogLines();
  const { loadPromptOverrides, promptText } = await import("@/lib/ivr/prompts");
  const p = await loadPromptOverrides(); // wording from Hotline prompts > Texts and emails
  const text = [
    promptText(p, "msg_catalog_email_top"),
    ...lines.flatMap((c) => ["", c.category, ...c.items.map((i) => `- ${i.name}${i.description ? `: ${i.description}` : ""}`)]),
    "",
    promptText(p, "msg_catalog_email_bottom"),
  ].join("\n");
  return { subject: promptText(p, "msg_catalog_email_subject"), text };
}

export async function sendCatalogEmail(to: string) {
  const { subject, text } = await catalogEmail();
  const { getSettings } = await import("@/lib/settings");
  const s = await getSettings();
  // The PDF goes along only while "attach automatically" is on; the catalog's name is added to the subject
  const { catalogPdfAttachment } = await import("@/lib/catalog-pdf");
  const pdf = s.catalogAutoAttach !== false ? await catalogPdfAttachment().catch(() => null) : null;
  // With the PDF attached: the catalog email wording (approved by Abraham, Nov 17, 2026; the Owner can edit it in Admin)
  if (pdf) {
    const t = catalogEmailTemplate(s);
    return sendEmail(to, t.subject, t.body, [pdf], { noThanks: true });
  }
  return sendEmail(to, subject, text, []);
}

export const CATALOG_NAME_TAG = "{Catalog Name}";
export const CATALOG_EMAIL_SUBJECT_DEFAULT = `${CATALOG_NAME_TAG} - Hup Up Attractions`;
export const CATALOG_EMAIL_BODY_DEFAULT = `Dear valued customer,\n\nFind our ${CATALOG_NAME_TAG} attached. You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1.\n\nThank you for choosing Hup Up Attractions!`;
const fillName = (t: string, name: string) => t.split(CATALOG_NAME_TAG).join(name);

/** "{Catalog Name} - Hup Up Attractions" */
export const catalogEmailSubject = (name: string) => fillName(CATALOG_EMAIL_SUBJECT_DEFAULT, name);
/** The approved catalog email (the logo header and signature are added to every email). */
export const catalogEmailBody = (name: string) => fillName(CATALOG_EMAIL_BODY_DEFAULT, name);

/**
 * The catalog email as it goes out (the automatic one and Compose > Add our catalog): the Owner's edited wording from
 * Admin, Catalog email & text, or the approved wording when blank, with the catalog's name filled in.
 */
export function catalogEmailTemplate(s: Record<string, unknown>): { subject: string; body: string } {
  const name = String(s.catalogName ?? "").trim() || "catalog";
  const subject = String(s.catalogEmailSubjectText ?? "").trim() || CATALOG_EMAIL_SUBJECT_DEFAULT;
  const body = String(s.catalogEmailBodyText ?? "").replace(/\r\n/g, "\n").trim() || CATALOG_EMAIL_BODY_DEFAULT;
  return { subject: fillName(subject, name), body: fillName(body, name) };
}

/** The catalog text (Abraham, word for word). */
export const catalogText = () => `${BUSINESS_NAME}: Here is our catalog: hupupattractions.com/#rentals To book, call ${PUBLIC_PHONE_DISPLAY}.`;

/** Log a catalog request on the contact (by the caller's phone, or the email address), and alert Abraham on failure. */
export async function recordCatalogRequest(input: { callerPhone: string | null; channel: "text" | "email"; to: string; sent: boolean; source: "phone" | "email" | "text_keyword" }) {
  const phone = input.callerPhone ?? (input.channel === "text" ? toE164(input.to) : null);
  let customerId: number | null = null;
  if (phone) {
    const [c] = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
    customerId = c?.id ?? (await db.insert(schema.customers).values({ phone, name: null }).returning({ id: schema.customers.id }))[0].id;
  } else if (input.channel === "email") {
    const [c] = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.email, input.to)).limit(1);
    customerId = c?.id ?? null;
  }
  await db.insert(schema.auditLog).values({
    action: input.sent ? "catalog.sent" : "catalog.failed",
    entityType: "customer",
    entityId: customerId ? String(customerId) : input.to,
    after: { channel: input.channel, to: input.to, source: input.source, at: logStamp() },
  });
  if (!input.sent) {
    const msg = `${BUSINESS_NAME}: a catalog ${input.channel} to ${input.to} failed to send (${logStamp()}).`;
    const owner = process.env.ADMIN_EMAIL;
    if (owner) await sendEmail(owner, "Catalog failed to send", msg).catch(() => null);
    const ownerPhone = toE164(config.adminPhone());
    if (ownerPhone && process.env.TWILIO_MESSAGING_SERVICE_SID) await sendSms(ownerPhone, msg, { kind: "system", event: "owner_alert" }).catch(() => null);
  }
  return customerId;
}

/** Subject "Catalog" or "catalogue", any capitals (Abraham, section 9). Allows "Re:"/"Fwd:" and spaces around it. */
export function isCatalogSubject(subject: string | null | undefined): boolean {
  return /^\s*((re|fwd?)\s*:\s*)*catalog(ue)?\s*[.!]?\s*$/i.test(subject ?? "");
}

/**
 * An email to info@ (via the Cloudflare Email Worker, once Abraham OKs the DNS change). Logs every catalog request;
 * replies with the PDF at most once per sender per day (New York day), and only once infoCatalogAutoreplyOn().
 */
export async function handleCatalogEmail(senderRaw: string, subject: string | null, now = new Date(), send: (to: string) => Promise<{ sent: boolean }> = sendCatalogEmail) {
  const sender = senderRaw.trim().toLowerCase();
  if (!isCatalogSubject(subject)) return { replied: false, reason: "not_catalog" as const };
  if (!/^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i.test(sender)) return { replied: false, reason: "bad_sender" as const };
  const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const earlier = await db
    .select()
    .from(schema.catalogEmailRequests)
    .where(and(eq(schema.catalogEmailRequests.sender, sender), eq(schema.catalogEmailRequests.replied, true), gte(schema.catalogEmailRequests.createdAt, new Date(now.getTime() - 36 * 3600_000))));
  const today = earlier.some((r) => nyDay(r.createdAt) === nyDay(now));
  const reason = !infoCatalogAutoreplyOn() ? "autoreply_off" : today ? "already_today" : null;
  let replied = false;
  if (!reason) replied = (await send(sender)).sent;
  await db.insert(schema.catalogEmailRequests).values({ sender, subject: subject?.slice(0, 200) ?? null, replied, reason: reason ?? (replied ? null : "send_failed"), createdAt: now });
  return { replied, reason: reason ?? (replied ? null : "send_failed") };
}

/** Section 18: texting CATALOG to the hotline gets the catalog text back. Not active yet: waits for Twilio texting. */
export const SMS_CATALOG_REPLY_ON = true; // Abraham, Nov 16, 2026: on (same text as key 8; once per number per day; never after STOP)

/** The whole text is "catalog" or "catalogue", any capitals, spaces and punctuation ignored. */
export function isCatalogText(body: string | null | undefined): boolean {
  return /^catalog(ue)?$/i.test((body ?? "").replace(/[^a-z]/gi, ""));
}

/**
 * Reply to a CATALOG text: once per number per New York day; never to a number that replied STOP; never a promo
 * sign-up. Logged on the contact. `send` is the app's normal text sender (STOP/HELP rules apply there too).
 */
export async function replyToCatalogText(
  from: string,
  opts: { optedOut: boolean; on?: boolean; now?: Date; send: (to: string, body: string, mediaUrls?: string[]) => Promise<{ sent: boolean }> },
) {
  const on = opts.on ?? SMS_CATALOG_REPLY_ON;
  const now = opts.now ?? new Date();
  if (!on) return { replied: false, reason: "not_active" as const };
  if (opts.optedOut) return { replied: false, reason: "opted_out" as const };
  const nyDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const earlier = await db
    .select({ at: schema.messages.createdAt })
    .from(schema.messages)
    .where(and(eq(schema.messages.toNumber, from), eq(schema.messages.event, "catalog_reply"), gte(schema.messages.createdAt, new Date(now.getTime() - 36 * 3600_000))));
  if (earlier.some((r) => nyDay(r.at) === nyDay(now))) return { replied: false, reason: "already_today" as const };
  const { messageText } = await import("@/lib/ivr/prompts");
  const r = await sendCatalogMessages(await messageText("msg_catalog_text"), (body, media) => opts.send(from, body, media));
  await recordCatalogRequest({ callerPhone: from, channel: "text", to: from, sent: r.sent, source: "text_keyword" });
  return { replied: r.sent, reason: r.sent ? null : ("send_failed" as const) };
}

/**
 * The catalog by text as separate messages (Abraham, Nov 17, 2026): first picture 1 with the catalog words, then
 * picture 2 alone (no words), in that order. Without pictures it is the words only, as before.
 */
/** The catalog photos for texts, in order, each with its own text (Abraham, Nov 17, 2026, item 14). */
export type CatalogTextItem = { photo: string; text: string };
export function parseCatalogTextItems(raw: unknown): CatalogTextItem[] {
  try {
    const list = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(list)) return [];
    return list
      .map((x) => ({ photo: String(x?.photo ?? ""), text: String(x?.text ?? "").slice(0, 1500) }))
      .filter((x) => /^\/api\/catalog-photo\/catalog\/text\/[a-z0-9-]+\.(jpg|png|webp)$/.test(x.photo))
      .slice(0, 10);
  } catch {
    return [];
  }
}

export async function catalogTextMessages(words: string): Promise<{ body: string; mediaUrls: string[] }[]> {
  const { getSettings } = await import("@/lib/settings");
  const { config } = await import("@/lib/config");
  const s = await getSettings();
  const abs = (p: string) => (p ? new URL(p, config.baseUrl()).toString() : "");
  // Abraham, Nov 18, 2026 (approved): the first text alone, "Hup Up Attractions: Here is our {Catalog Name}! ...",
  // then each catalog photo as its own message (with its own text, in the Owner's order)
  const first = { body: words.split(CATALOG_NAME_TAG).join(String(s.catalogName ?? "").trim() || "catalog"), mediaUrls: [] as string[] };
  const items = parseCatalogTextItems(s.catalogTextItems);
  if (items.length) return [first, ...items.map((i) => ({ body: i.text, mediaUrls: [abs(i.photo)] }))];
  const pictures = [abs(s.catalogTextPicture1), abs(s.catalogTextPicture2)].filter(Boolean);
  return [first, ...pictures.map((p) => ({ body: "", mediaUrls: [p] }))];
}

/** Send the catalog messages one after the other; the first decides whether it counts as sent. */
export async function sendCatalogMessages(words: string, send: (body: string, mediaUrls: string[]) => Promise<{ sent: boolean }>) {
  const msgs = await catalogTextMessages(words);
  const first = await send(msgs[0].body, msgs[0].mediaUrls);
  if (first.sent) for (const m of msgs.slice(1)) await send(m.body, m.mediaUrls);
  return first;
}
