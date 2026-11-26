import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { pickupAfterShabbesMin } from "@/lib/holiday-rentals";
import { phonePayLimits } from "@/lib/phonepay-watch";

/* Hark's review H4 (Nov 26, 2026): a number the Admin page accepts is the number the code uses, at both ends. */
describe("the code uses what the pages accept", () => {
  it("pickup after Shabbes: 0 to 300 minutes as typed (0 no longer turns into 60)", () => {
    expect(pickupAfterShabbesMin({ holidayPickupAfterShabbesMin: "0" } as never)).toBe(0);
    expect(pickupAfterShabbesMin({ holidayPickupAfterShabbesMin: "300" } as never)).toBe(300);
    expect(pickupAfterShabbesMin({ holidayPickupAfterShabbesMin: "301" } as never)).toBe(60);
  });
  it("card limits: 1 to 20, the same on the PhonePay page and in the code", () => {
    expect(phonePayLimits({ phonePayTriesPerCall: "20", phonePayCallsPerDay: "1" })).toMatchObject({ triesPerCall: 20, callsPerDay: 1 });
    expect(readFileSync("src/app/admin/(app)/phone/phonepay/actions.ts", "utf8")).toContain("tries <= 20");
  });
  it("the PhonePay page checks every number before saving anything, and refuses a bad wait instead of ignoring it", () => {
    const f = readFileSync("src/app/admin/(app)/phone/phonepay/actions.ts", "utf8");
    expect(f.indexOf("The silence check must be")).toBeLessThan(f.indexOf('saveSetting("phonePayTriesPerCall"'));
    expect(f).toContain("The wait after a declined card must be a number of seconds from 0 to 15.");
  });
});
