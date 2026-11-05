import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

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
  method: "web_checkbox" | "staff_read";
  acceptanceStatement: string;
  amountCents?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  pageUrl?: string | null;
  userId?: number | null;
};

export async function recordTermsAcceptance(input: AcceptanceInput) {
  if (!input.termsText.trim()) throw new Error("Terms text is required.");
  if (!input.acceptanceStatement.trim()) throw new Error("Acceptance statement is required.");
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
