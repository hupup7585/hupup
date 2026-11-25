import { describe, expect, it } from "vitest";
import { payState } from "@/lib/pay-label";

/* Batch 4 item 2 (Abraham, Nov 25, 2026): the grand total and a plain payment state. */
describe("payment label", () => {
  it("paid in full shows the grand total, not the rentals", () => {
    expect(payState({ totalCents: 12975, subtotalCents: 11000, paidCents: 12975 }).label).toBe("Total $129.75 · Paid in full");
  });
  it("a declined card with nothing paid", () => {
    const s = payState({ totalCents: 12975, subtotalCents: 11000, paidCents: 0, paymentResult: "declined" });
    expect(s.label).toBe("Total $129.75 · Not paid · card declined");
    expect(s.declined).toBe(true);
  });
  it("part paid and not paid", () => {
    expect(payState({ totalCents: 10000, subtotalCents: 9000, paidCents: 4000 }).state).toBe("Paid $40 · $60 due");
    expect(payState({ totalCents: null, subtotalCents: 9000, paidCents: 0 }).label).toBe("Total $90 · Not paid");
  });
});
