import { loadPromptOverrides, promptText, type PromptOverrides } from "@/lib/ivr/prompts";
import { sendEmail } from "@/lib/notify";
import { orderNumber } from "@/lib/orders";
import { inboxWhen } from "@/lib/inbox-format";

/**
 * Our own receipt after a phone payment is Paid (Abraham, Nov 12, 2026), from info@. Approved Nov 13, 2026. Stripe's own automatic receipts are turned off in Stripe's settings, so
 * customers get just this one.
 */
export const RECEIPT_APPROVED = true; // Abraham, Nov 13, 2026: approved; replaces the short "payment received" email

export function phoneReceipt(input: { orderId: number; paidAt: Date; amountCents: number; last4: string | null; name?: string | null; grouped?: string | null }, overrides: PromptOverrides = {}) {
  const num = orderNumber(input.orderId);
  const body = promptText(overrides, "msg_receipt_body", {
    greeting: `Hi${input.name ? ` ${input.name.split(" ")[0]}` : ""},`,
    number: num,
    paid_on: inboxWhen(input.paidAt),
    amount: (input.amountCents / 100).toFixed(2),
    last4: input.last4 ?? "on file",
  });
  return {
    subject: promptText(overrides, "msg_receipt_subject", { number: num }),
    // Abraham, Nov 27, 2026 (item 4): the same grouping as the pay page, after the receipt wording
    text: input.grouped ? `${body}\n\n${input.grouped}` : body,
  };
}

export async function sendPhoneReceipt(to: string | null | undefined, input: Parameters<typeof phoneReceipt>[0], approved = RECEIPT_APPROVED) {
  if (!approved || !to) return { sent: false };
  const r = phoneReceipt({ ...input, grouped: input.grouped ?? (await receiptGrouping(input.orderId, input.amountCents).catch(() => null)) }, await loadPromptOverrides());
  return sendEmail(to, r.subject, r.text);
}

/** The receipt's grouped lines: the days paid, Discount, Partial payment (paid before this payment) and Total due. */
export async function receiptGrouping(orderId: number, paidNowCents: number): Promise<string | null> {
  const { getPaymentGroup } = await import("@/lib/orders");
  const group = await getPaymentGroup(orderId);
  if (!group) return null;
  const { payBreakdown, payBreakdownText, pickupSentence } = await import("@/lib/pay-breakdown");
  const { getSettings } = await import("@/lib/settings");
  const live = group.orders.filter((d) => d.order.status !== "CANCELLED");
  return payBreakdownText(payBreakdown(group.orders, { paidNowCents }), pickupSentence(live.map((d) => d.order), (await getSettings()) as never));
}
