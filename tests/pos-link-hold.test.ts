import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAYMENT_HOLD_MINUTES, POS_LINK_HOLD_MINUTES } from "@/lib/orders";

/* Admin New booking payment link: rentals held 25 minutes (Abraham, Nov 13, 2026; was 60, text said 2 hours). */
describe("New booking payment link hold", () => {
  it("25 minutes, and the customer text and staff message say the same time", () => {
    expect(POS_LINK_HOLD_MINUTES).toBe(25);
    expect(PAYMENT_HOLD_MINUTES).toBe(10); // phone bookings unchanged
    const a = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    expect(a).toContain("minutesFromNow(POS_LINK_HOLD_MINUTES)");
    expect(a).toContain("Pay securely within ${POS_LINK_HOLD_MINUTES} minutes to confirm: ${link}");
    expect(a).toContain("held for ${POS_LINK_HOLD_MINUTES} minutes");
    expect(a).not.toMatch(/2 hours|minutesFromNow\(60\)/);
  });
});
