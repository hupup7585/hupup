import { describe, expect, it } from "vitest";
import { PIECE_ALIAS, PROMPTS } from "@/lib/ivr/prompts";
import { addedVars } from "@/lib/ivr/flow";
import { allSlots } from "@/lib/recording-slots";

/* Item 6 (Abraham, Nov 25, 2026, 2:02 PM): "Successfully added to your cart:" then the quantity and item name only; never
 * the date (already confirmed) or the catalog item number. */
describe("Box 25 added line: name only", () => {
  it("slot text exact; vars qty and item; the 'for' date piece no longer belongs to this line", () => {
    expect(PROMPTS.box25_added.text).toBe("Successfully added to your cart: {qty} {item}.");
    expect(PROMPTS.box25_added.vars).toEqual(["qty", "item"]);
    expect(PIECE_ALIAS["box25_added#2"]).toBeUndefined();
    const slot = new Map(allSlots().map((s) => [s.key, s.text]));
    expect(slot.get("box25_added#1")).toBe("Successfully added to your cart:");
    expect([...slot.keys()].filter((k) => k.startsWith("box25_added#"))).toEqual(["box25_added#1"]);
  });
  it("no date, even for a two-day booking; quantity and plural stay; an add-on named with its count is said as named", () => {
    expect(addedVars({ name: "Royal Castle", qty: 1, date: "2027-03-15" })).toEqual({ qty: 1, item: "Royal Castle" });
    expect(addedVars({ name: "Royal Castle", qty: 2, date: "2027-03-15", date2: "2027-03-16" })).toEqual({ qty: 2, item: "Royal Castles" });
    expect(addedVars({ name: "500 Ocean Balls", qty: 1, date: "2027-03-15" })).toEqual({ qty: "", item: "500 Ocean Balls" });
    expect(addedVars({ name: "Additional 6-Pack Laser Guns", qty: 1, date: "2027-03-15" })).toEqual({ qty: 1, item: "Additional 6-Pack Laser Guns" });
  });
});
