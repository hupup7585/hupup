import { loadPromptOverrides, promptText, type PromptOverrides } from "@/lib/ivr/prompts";
import { sendEmail } from "@/lib/notify";
import { orderNumber } from "@/lib/orders";
import { inboxWhen } from "@/lib/inbox-format";

/**
 * Our own receipt after a phone payment is Paid (Abraham, Nov 12, 2026), from info@. Approved Nov 13, 2026. Stripe's own automatic receipts are turned off in Stripe's settings, so
 * customers get just this one.
 */
export const RECEIPT_APPROVED = true; // Abraham, Nov 13, 2026: approved; replaces the short "payment received" email

export function phoneReceipt(input: { orderId: number; paidAt: Date; amountCents: number; last4: string | null; name?: string | null }, overrides: PromptOverrides = {}) {
  const num = orderNumber(input.orderId);
  return {
    subject: promptText(overrides, "msg_receipt_subject", { number: num }),
    text: promptText(overrides, "msg_receipt_body", {
      greeting: `Hi${input.name ? ` ${input.name.split(" ")[0]}` : ""},`,
      number: num,
      paid_on: inboxWhen(input.paidAt),
      amount: (input.amountCents / 100).toFixed(2),
      last4: input.last4 ?? "on file",
    }),
  };
}

export async function sendPhoneReceipt(to: string | null | undefined, input: Parameters<typeof phoneReceipt>[0], approved = RECEIPT_APPROVED) {
  if (!approved || !to) return { sent: false };
  const r = phoneReceipt(input, await loadPromptOverrides());
  return sendEmail(to, r.subject, r.text);
}
