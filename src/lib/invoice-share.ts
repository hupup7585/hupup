/**
 * Sending an invoice to the customer: the email carries a link to the customer's own page, where they can view and
 * print it. Wording dictated and approved by Abraham, Nov 15, 2026.
 */
export const INVOICE_EMAIL_APPROVED = true; // the starting value of the Owner setting invoiceEmailOn (Bookkeeping > Settings)

/** Admin handoff Phase 2 (Nov 27, 2026): emailing invoices is an Owner setting now (on, as approved Nov 15, 2026). */
export async function invoiceEmailOn(): Promise<boolean> {
  const { getSettings } = await import("@/lib/settings");
  const v = ((await getSettings()) as { invoiceEmailOn?: unknown }).invoiceEmailOn;
  return v === true || v === "true";
}

/** "INV-1001" or "1001" to "Invoice #1001" (Abraham's wording). */
export const invoiceLabel = (number: string) => `Invoice #${number.replace(/^INV-?/i, "")}`;

export const INVOICE_EMAIL_DRAFT = {
  subject: (number: string) => `Hup Up Attractions ${invoiceLabel(number)}`,
  body: (number: string, link: string) =>
    `Thank you for choosing Hup Up Attractions! Here is your invoice, ${invoiceLabel(number)}. You can view it and print it here:\n${link}\n\nIf you have any questions, please call us at (845) 777-7585.\n\nHup Up Attractions, We appreciate your business with us.`,
};
