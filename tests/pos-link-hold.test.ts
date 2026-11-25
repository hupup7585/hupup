import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAYMENT_HOLD_MINUTES, POS_LINK_HOLD_MINUTES } from "@/lib/orders";

/* Admin New booking payment link: rentals held 25 minutes (Abraham, Nov 13, 2026; was 60, text said 2 hours). */
describe("New booking payment link hold", () => {
  it("25 minutes, and the customer text and staff message say the same time", () => {
    expect(POS_LINK_HOLD_MINUTES).toBe(25);
    expect(PAYMENT_HOLD_MINUTES).toBe(10); // phone bookings unchanged
    const a = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    // Batch 4 (Nov 25, 2026): the Admin hold is its own setting, default 25, used for the hold and both messages
    expect(a).toContain('const holdMin = await linkHoldMinutes("admin")');
    expect(a).toContain("minutesFromNow(holdMin)");
    expect(a).toContain("Pay securely within ${holdMin} minutes to confirm: ${link}");
    expect(a).toContain("held for ${holdMin} minutes");
    expect(a).not.toMatch(/2 hours|minutesFromNow\(60\)/);
  });
});

describe("two separate payment-link hold settings (Abraham, Nov 25, 2026)", () => {
  it("phone 10 and Admin 25 by default, each its own setting", async () => {
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    expect(SETTING_DEFAULTS.phoneLinkHoldMinutes).toBe("10");
    expect(SETTING_DEFAULTS.adminLinkHoldMinutes).toBe("25");
  });
});
