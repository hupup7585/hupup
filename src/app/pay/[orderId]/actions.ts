"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { getPaymentGroup } from "@/lib/orders";
import { paymentLink } from "@/lib/sola";
import { CURRENT_TERMS_VERSION, recordTermsAcceptance, verifyPayToken } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";
import { PAY_AGREE_LABEL } from "./label";
import { recordBookingConsents } from "@/lib/booking-consent";


/** Customer checked the (unchecked-by-default) box: record the acceptance, then continue to Sola. */
export async function agreeAndPayAction(orderId: number, token: string, agreed: boolean, sms: { transactional: boolean; marketing: boolean } = { transactional: false, marketing: false }): Promise<{ error: string } | void> {
  if (!verifyPayToken(orderId, token)) return { error: "This payment link is not valid. Please call us." };
  if (!agreed) return { error: "Please check the box to agree to the Terms and Conditions before paying." };
  // One charge for every rental day booked together (payment group)
  const group = await getPaymentGroup(orderId);
  if (!group) return { error: "Order not found." };
  const full = group.primary;
  if (full.order.status !== "PENDING_PAYMENT") return { error: "This order is not waiting for payment. Please call us." };
  const due = group.due;
  if (due <= 0) return { error: "Nothing left to pay." };
  const h = await headers();
  // One record per rental day paid together (Abraham: every reservation), each with date, time, IP and version
  for (const day of group.orders.filter((x) => x.order.status === "PENDING_PAYMENT")) {
    await recordTermsAcceptance({
      orderId: day.order.id,
      customerId: full.customer?.id ?? null,
      phone: full.customer?.phone ?? null,
      termsVersion: CURRENT_TERMS_VERSION,
      termsText: TERMS_TEXT,
      method: "web_checkbox",
      acceptanceStatement: `Checked "${PAY_AGREE_LABEL}" (unchecked by default) and continued to payment`,
      amountCents: day.order.id === full.order.id ? due : null,
      ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
      userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
      pageUrl: `${config.baseUrl()}/pay/${orderId}`,
    });
  }
  // The two optional text-consent boxes (never required to pay); saved like every other consent
  await recordBookingConsents({
    phone: full.customer?.phone,
    transactional: sms.transactional === true,
    marketing: sms.marketing === true,
    source: "web",
    orderId,
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    pageUrl: `${config.baseUrl()}/pay/${orderId}`,
  });
  redirect(paymentLink({ orderId: full.order.id, amountCents: due, name: full.customer?.name, email: full.customer?.email, phone: full.customer?.phone }));
}
