import { describe, expect, it } from "vitest";
import { computeTotals, deliveryZone, taxOn } from "@/lib/pricing";
import { SETTING_DEFAULTS } from "@/lib/settings";
import { PAYMENT_HOLD_MINUTES, PHONE_HOLD_MINUTES } from "@/lib/orders";

const s = { ...SETTING_DEFAULTS };

describe("delivery zones (editable lists)", () => {
  it("Kiryas Joel addresses are the $10 zone, even with the shared 10950 ZIP", () => {
    expect(deliveryZone("51 Forest Rd, Kiryas Joel, NY 10950", s)).toBe("kj");
    expect(deliveryZone("3 Garfield Rd, Town of Palm Tree", s)).toBe("kj");
  });
  it("surrounding Orange County towns are the $15 zone", () => {
    for (const a of ["12 Main St, Monroe NY 10950", "7 Elm St, Highland Mills", "1 Mill St, Washingtonville"]) expect(deliveryZone(a, s), a).toBe("area");
  });
  it("anything else is outside the area", () => {
    for (const a of ["5 Main Street, Albany", "", null, "100 Broadway, New York"]) expect(deliveryZone(a as string, s)).toBe("outside");
  });
});

describe("totals: items + delivery + Orange County tax on the whole order", () => {
  it("8.125% tax, rounded to the cent", () => {
    expect(taxOn(26000, "8.125")).toBe(2113); // 21.125 -> 21.13
    expect(taxOn(1000, "8.125")).toBe(81);
  });
  it("KJ: $10 delivery; area: $15 delivery; outside: no checkout", () => {
    expect(computeTotals(25000, "kj", s)).toEqual({ subtotalCents: 25000, deliveryFeeCents: 1000, taxCents: 2113, totalCents: 28113, taxPercent: "8.125", zone: "kj" });
    expect(computeTotals(25000, "area", s)).toMatchObject({ deliveryFeeCents: 1500, taxCents: 2153, totalCents: 28653 });
    expect(computeTotals(25000, "outside", s)).toBeNull();
  });
  it("cart hold is 15 minutes; the payment window is 10 minutes (Abraham, Nov 13, 2026)", () => {
    expect(PHONE_HOLD_MINUTES).toBe(15);
    expect(PAYMENT_HOLD_MINUTES).toBe(10);
  });
});
