"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { getPaymentGroup } from "@/lib/orders";
import { paymentLink } from "@/lib/sola";
import { CURRENT_TERMS_VERSION, recordTermsAcceptance, verifyPayToken } from "@/lib/rental-terms";
import { TERMS_TEXT } from "@/lib/terms-content";
import { PAY_AGREE_LABEL } from "./label";


/** Customer checked the (unchecked-by-default) box: record the acceptance, then continue to Sola. */
export async function agreeAndPayAction(orderId: number, token: string, agreed: boolean): Promise<{ error: string } | void> {
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
  await recordTermsAcceptance({
    orderId,
    customerId: full.customer?.id ?? null,
    phone: full.customer?.phone ?? null,
    termsVersion: CURRENT_TERMS_VERSION,
    termsText: TERMS_TEXT,
    method: "web_checkbox",
    acceptanceStatement: `Checked "${PAY_AGREE_LABEL}" (unchecked by default) and continued to payment`,
    amountCents: due,
    ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
    pageUrl: `${config.baseUrl()}/pay/${orderId}`,
  });
  redirect(paymentLink({ orderId: full.order.id, amountCents: due, name: full.customer?.name, email: full.customer?.email, phone: full.customer?.phone }));
}
