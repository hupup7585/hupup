import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { invoiceCustomerLink, verifyInvoiceLink } from "@/lib/signed-link";
import { INVOICE_EMAIL_APPROVED, INVOICE_EMAIL_DRAFT } from "@/lib/invoice-share";

/* Print every invoice, in Admin and on the customer's own page (Abraham, Nov 15, 2026). */
describe("invoice printing and sharing", () => {
  it("the customer link is signed: the right one opens, a changed one does not", () => {
    process.env.AUTH_SECRET = "test-secret-for-invoice-links-123456";
    const link = invoiceCustomerLink(42);
    const t = new URL(link).searchParams.get("t");
    expect(link).toContain("/invoice/42?t=");
    expect(verifyInvoiceLink(42, t)).toBe(true);
    expect(verifyInvoiceLink(43, t)).toBe(false);
    expect(verifyInvoiceLink(42, "nope")).toBe(false);
  });
  it("Admin and the customer page show the same printable invoice with a Print button; the customer page is never indexed", () => {
    const admin = readFileSync("src/app/admin/(app)/bookkeeping/invoice/[id]/page.tsx", "utf8");
    const pub = readFileSync("src/app/invoice/[id]/page.tsx", "utf8");
    for (const p of [admin, pub]) {
      expect(p).toContain("<InvoiceDocument d={d} />");
      expect(p).toContain("<PrintButton />");
    }
    expect(pub).toContain("robots: { index: false, follow: false }");
    expect(pub).toContain("verifyInvoiceLink(id, t)");
    expect(admin).toContain('label="Copy customer link"');
  });
  it("emailing the link waits for Abraham's OK on the wording; every word spelled out", () => {
    expect(INVOICE_EMAIL_APPROVED).toBe(false);
    const text = INVOICE_EMAIL_DRAFT.subject("INV-1001") + INVOICE_EMAIL_DRAFT.body("INV-1001", "https://x");
    expect(text).not.toMatch(/\b\w+'(s|re|ll|t|ve|d)\b/);
    expect(text).toContain("Hup Up Attractions");
  });
});
