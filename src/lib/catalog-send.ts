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

/** The info@ "subject Catalog" auto-reply (section 9) is off until Abraham approves its reply wording. */
export const INFO_CATALOG_AUTOREPLY_ON = false;

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
  const text = [
    `Thank you for your interest in ${BUSINESS_NAME}!`,
    "",
    "Here is our catalog:",
    ...lines.flatMap((c) => ["", c.category, ...c.items.map((i) => `- ${i.name}${i.description ? `: ${i.description}` : ""}`)]),
    "",
    "See our rentals: hupupattractions.com/#rentals",
    `To book, call ${PUBLIC_PHONE_DISPLAY}.`,
  ].join("\n");
  return { subject: `${BUSINESS_NAME} catalog`, text };
}

export async function sendCatalogEmail(to: string) {
  const { subject, text } = await catalogEmail();
  const { catalogPdfAttachment } = await import("@/lib/catalog-pdf");
  const pdf = await catalogPdfAttachment().catch(() => null);
  return sendEmail(to, subject, text, pdf ? [pdf] : []);
}

/** The catalog text (Abraham, word for word). */
export const catalogText = () => `${BUSINESS_NAME}: Here is our catalog: hupupattractions.com/#rentals To book, call ${PUBLIC_PHONE_DISPLAY}.`;

/** Log a catalog request on the contact (by the caller's phone, or the email address), and alert Abraham on failure. */
export async function recordCatalogRequest(input: { callerPhone: string | null; channel: "text" | "email"; to: string; sent: boolean; source: "phone" | "email" }) {
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
 * replies with the PDF at most once per sender per day (New York day), and only once INFO_CATALOG_AUTOREPLY_ON.
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
  const reason = !INFO_CATALOG_AUTOREPLY_ON ? "autoreply_off" : today ? "already_today" : null;
  let replied = false;
  if (!reason) replied = (await send(sender)).sent;
  await db.insert(schema.catalogEmailRequests).values({ sender, subject: subject?.slice(0, 200) ?? null, replied, reason: reason ?? (replied ? null : "send_failed"), createdAt: now });
  return { replied, reason: reason ?? (replied ? null : "send_failed") };
}
