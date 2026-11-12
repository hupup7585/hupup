/**
 * Pay by keypad during the call (Abraham, Nov 12, 2026, section 14). Prepared only: NOT ACTIVE YET.
 *
 * Plan (nothing below is built until Abraham approves, and no money is spent):
 *  - Right after the full order read-back, the caller pays by keypad with Twilio <Pay>. The card goes from Twilio
 *    straight to Sola (only if Sola accepts Twilio's Generic Pay Connector itself) or through the Shuttle Pay
 *    Connector, so card numbers never reach our server. We never build an endpoint that receives card numbers.
 *  - Twilio PCI mode and the connector are turned on only after Abraham's yes (PCI mode can't be turned off).
 *  - The payment link by email (text once approved) stays as the backup, e.g. when a card is declined.
 *  - Result saved on the order (orders table, shown on the order page in Admin and in the orders sheet):
 *    payment result (approved / declined), card brand and last 4 digits, Sola reference number, amount, date and time,
 *    and the order's payment status (paid, or still waiting with the link sent).
 *
 * Vercel variable names (Abraham adds the values himself; never in chat): SOLA_API_KEY (the "Website" API key) and
 * SOLA_IFIELDS_KEY (the iFields key). Still open: SOLA_PAYMENTSITE_NAME and SOLA_WEBHOOK_PIN.
 */
export type KeypadPayMode = "off" | "live";
export const KEYPAD_PAY_MODE: KeypadPayMode = "off";

export const KEYPAD_PAY_NOT_ACTIVE_REASON =
  "Waiting for Sola and Shuttle to confirm how Twilio Pay reaches Sola and the fees, then Abraham's approval (Twilio PCI mode, the connector).";

/** Where the keypad payment step sits: right after the order read-back. Off = the payment link (backup) as today. */
export function keypadPayOn(mode: KeypadPayMode = KEYPAD_PAY_MODE) {
  return mode === "live";
}

export const ORDER_PAYMENT_FIELDS_PLANNED = ["paymentResult", "cardBrand", "cardLast4", "solaRefNum", "paidAmountCents", "paidAt", "paymentStatus"] as const;
