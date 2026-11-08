import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { TERMS_EFFECTIVE_DATE, TERMS_TEXT, TERMS_VERSION } from "@/lib/terms-content";

/**
 * Rental terms acceptance (NY electronic records and signatures). Before paying, the customer sees the exact
 * terms and checks an acceptance box; we store the full text, its version and hash, the acceptance statement,
 * time, order, phone, amount, IP and browser. The Sola payment webhook then links the payment to that record.
 *
 * The terms wording itself is not in this file: it is pending Abram's approval and goes in src/lib/rental-terms-copy.ts.
 */

export function termsHash(text: string): string {
  return createHash("sha256").update(text.trim()).digest("hex");
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET must be set");
  return s;
}

/** Unguessable per-order token for the "review terms and pay" link texted to the customer. */
export function payToken(orderId: number): string {
  return createHmac("sha256", secret()).update(`pay:${orderId}`).digest("base64url").slice(0, 32);
}

export function verifyPayToken(orderId: number, token: string | null | undefined): boolean {
  if (!token) return false;
  const a = Buffer.from(payToken(orderId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type AcceptanceInput = {
  orderId: number;
  customerId?: number | null;
  phone?: string | null;
  termsVersion: string;
  termsText: string;
  method: "web_checkbox" | "web_continue" | "phone_hash" | "staff_read" | "staff_phone" | "staff_text" | "staff_email" | "staff_in_person";
  acceptanceStatement: string;
  amountCents?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  userId?: number | null;
  callerPhone?: string | null;
  callSid?: string | null;
};

export async function recordTermsAcceptance(input: AcceptanceInput) {
  if (!input.termsText.trim()) throw new Error("Terms text is required.");
  if (!input.acceptanceStatement.trim()) throw new Error("Acceptance statement is required.");
  if (input.termsVersion === TERMS_VERSION) await ensureTermsVersionStored();
  const [row] = await db
    .insert(schema.termsAcceptances)
    .values({
      orderId: input.orderId,
      customerId: input.customerId ?? null,
      phone: input.phone ?? null,
      termsVersion: input.termsVersion,
      termsHash: termsHash(input.termsText),
      termsText: input.termsText,
      method: input.method,
      acceptanceStatement: input.acceptanceStatement,
      amountCents: input.amountCents ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      pageUrl: input.pageUrl ?? null,
      userId: input.userId ?? null,
      callerPhone: input.callerPhone ?? null,
      callSid: input.callSid ?? null,
    })
    .returning({ id: schema.termsAcceptances.id });
  return row.id;
}

/** Most recent acceptance for an order, or null. */
export async function latestAcceptance(orderId: number) {
  const [row] = await db
    .select({ id: schema.termsAcceptances.id, termsVersion: schema.termsAcceptances.termsVersion, termsHash: schema.termsAcceptances.termsHash, acceptedAt: schema.termsAcceptances.acceptedAt })
    .from(schema.termsAcceptances)
    .where(eq(schema.termsAcceptances.orderId, orderId))
    .orderBy(desc(schema.termsAcceptances.acceptedAt), desc(schema.termsAcceptances.id))
    .limit(1);
  return row ?? null;
}

/** On payment: write an audit entry tying the payment to the terms the customer accepted (or noting none). */
export async function linkPaymentToAcceptance(orderId: number, paymentRef: string | null, cents: number) {
  const acc = await latestAcceptance(orderId);
  await db.insert(schema.auditLog).values({
    userId: null,
    action: acc ? "payment.terms_accepted" : "payment.no_terms_acceptance",
    entityType: "order",
    entityId: String(orderId),
    after: { paymentRef, cents, acceptanceId: acc?.id ?? null, termsVersion: acc?.termsVersion ?? null, termsHash: acc?.termsHash ?? null, acceptedAt: acc?.acceptedAt ?? null },
  });
  return acc;
}

/** Version of the business Terms and Conditions (/terms) customers agree to. Bump when /terms changes. */
// History: "terms-2026-11-05-draft" (before sections A-E). The current version lives in terms-content.ts.
export const CURRENT_TERMS_VERSION = TERMS_VERSION;

/** Store a permanent copy of the current Terms version (once per version). */
export async function ensureTermsVersionStored() {
  await db
    .insert(schema.termsVersions)
    .values({ version: TERMS_VERSION, effectiveDate: TERMS_EFFECTIVE_DATE, text: TERMS_TEXT, textHash: termsHash(TERMS_TEXT) })
    .onConflictDoNothing();
}

/**
 * Is the Terms flow on? Always on previews (for testing). On the live site only once Abraham's final Terms are in
 * (TERMS_EFFECTIVE_DATE is no longer "draft"). While off on live: no /terms page or links, no hotline Terms step, no
 * Terms box before payment, no staff Terms question; payment links go straight to the secure payment page.
 */
export function termsActive(env: Record<string, string | undefined> = process.env): boolean {
  return env.VERCEL_ENV !== "production" || TERMS_EFFECTIVE_DATE !== "draft";
}

/** Customer-facing payment link: our review-and-pay page (Terms box) which then continues to Sola. */
export function payPageLink(orderId: number): string {
  return `${(process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "")}/pay/${orderId}?t=${payToken(orderId)}`;
}
