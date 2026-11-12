import { BUSINESS_NAME } from "@/lib/config";
import { sendEmail } from "@/lib/notify";
import { orderNumber } from "@/lib/orders";
import { inboxWhen } from "@/lib/inbox-format";

/**
 * Our own receipt after a phone payment is Paid (Abraham, Nov 12, 2026), from info@. DRAFT: not sent until Abraham
 * approves the wording (RECEIPT_APPROVED). Stripe's own automatic receipts are turned off in Stripe's settings, so
 * customers get just this one.
 */
export const RECEIPT_APPROVED = false;

export function phoneReceipt(input: { orderId: number; paidAt: Date; amountCents: number; last4: string | null; name?: string | null }) {
  const num = orderNumber(input.orderId);
  return {
    subject: `${BUSINESS_NAME} receipt for order #${num}`,
    text: [
      `Hi${input.name ? ` ${input.name.split(" ")[0]}` : ""},`,
      "",
      "Thank you for your payment! Here is your receipt.",
      "",
      `Order number: ${num}`,
      `Paid on: ${inboxWhen(input.paidAt)}`,
      `Amount: $${(input.amountCents / 100).toFixed(2)}`,
      `Card: ending in ${input.last4 ?? "on file"}`,
      "",
      "Your rentals are booked. If you have any questions, call us at (845) 777-7585 or reply to this email.",
      "",
      BUSINESS_NAME,
      "hupupattractions.com",
    ].join("\n"),
  };
}

export async function sendPhoneReceipt(to: string | null | undefined, input: Parameters<typeof phoneReceipt>[0], approved = RECEIPT_APPROVED) {
  if (!approved || !to) return { sent: false };
  const r = phoneReceipt(input);
  return sendEmail(to, r.subject, r.text);
}
