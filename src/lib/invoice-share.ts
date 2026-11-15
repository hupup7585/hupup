/**
 * Sending an invoice to the customer (Abraham, Nov 15, 2026): the email carries a link to the customer's own page,
 * where they can view and print it. The wording is a DRAFT: the button stays off until Abraham approves it.
 */
export const INVOICE_EMAIL_APPROVED = false;

export const INVOICE_EMAIL_DRAFT = {
  subject: (number: string) => `Hup Up Attractions invoice ${number}`,
  body: (number: string, link: string) =>
    `Hello,\n\nThank you for choosing Hup Up Attractions. Here is your invoice ${number}. You can view it and print it here:\n${link}\n\nIf you have any questions, please call us at (845) 777-7585.\n\nHup Up Attractions`,
};
