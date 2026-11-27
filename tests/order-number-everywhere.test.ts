import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* The order number in the payment link text and email and on every receipt (Abraham OK, Nov 27, 2026, 2:14 AM): the
 * same number the phone reads out and Admin shows (1000 + the order's id). */
import { PROMPTS } from "@/lib/ivr/prompts";
import { orderNumber } from "@/lib/order-number";
import { orderNumber as adminNumber } from "@/lib/orders";

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);

describe("order number everywhere", () => {
  it("one number for the phone, Admin, texts, emails and receipts", () => {
    expect(orderNumber(31)).toBe("1031");
    expect(adminNumber(31)).toBe(orderNumber(31));
  });
  it("payment link text and email (phone orders) show it", () => {
    expect(fill(PROMPTS.msg_payment_link.text, { number: orderNumber(31) })).toContain("order #1031");
    expect(fill(PROMPTS.msg_payment_link_subject.text, { number: orderNumber(31) })).toContain("#1031");
  });
  it("payment link text and email from Admin and New booking show it", () => {
    for (const f of ["src/app/admin/(app)/orders/actions.ts", "src/app/admin/(app)/pos/actions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/subject: `\$\{BUSINESS_NAME\} order #\$\{orderNumber\(/);
      expect(src, f).toMatch(/body: `\$\{BUSINESS_NAME\} order #\$\{orderNumber\(/);
    }
  });
  it("receipt text and email show it", () => {
    expect(fill(PROMPTS.msg_receipt_subject.text, { number: orderNumber(31) })).toContain("order #1031");
    expect(fill(PROMPTS.msg_receipt_body.text, { number: orderNumber(31) })).toContain("Order number: 1031");
    expect(fill(PROMPTS.msg_payment_received.text, { number: orderNumber(31) })).toContain("order #1031");
    expect(fill(PROMPTS.msg_payment_received_days.text, { number: orderNumber(31) })).toContain("order #1031");
  });
  it("the printed and PDF receipt/invoice shows the order number, not the database id", () => {
    const src = readFileSync("src/components/InvoiceDocument.tsx", "utf8");
    expect(src).toContain("Order {orderNumber(doc.orderId)}");
    expect(src).not.toContain("Booking #{doc.orderId}");
  });
});
