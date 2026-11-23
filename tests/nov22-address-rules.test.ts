import { describe, expect, it, vi } from "vitest";

/* Abraham, Nov 22, 2026 (after 4:16 PM): address read-back rules, the directory list file, the shared number alert. */
const sent = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; body: string }[], texts: [] as { to: string; body: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({
  sendEmail: async (to: string, subject: string, body: string) => (sent.emails.push({ to, subject, body }), { sent: true }),
  sendSms: async (to: string, body: string) => (sent.texts.push({ to, body }), { sent: true }),
}));
vi.mock("@/lib/voicemail", async (orig) => ({ ...(await orig<typeof import("@/lib/voicemail")>()), textingActive: () => true }));

import { db, schema } from "@/lib/db";

describe("address read-back rules (approved)", () => {
  it("house like an amount, unit digit by digit, town and state as one phrase, Blooming Grove first, zip digit by digit", async () => {
    const { spokenAddress, houseWords, unitWords, spokenName, townPhrase } = await import("@/lib/spoken-address");
    expect(houseWords("53")).toBe("fifty three");
    expect(houseWords("279")).toBe("two hundred seventy nine");
    expect(unitWords("312")).toBe("three one two");
    expect(unitWords("001")).toBe("zero zero one");
    expect(unitWords("302A")).toBe("three zero two A");
    expect(unitWords("S011")).toBe("S zero one one");
    expect(unitWords("Bsmt")).toBe("basement");
    expect(townPhrase("Highland Mills")).toBe("Highland Mills New York");
    expect(spokenAddress({ house: "21-312", street: "Rovna Court", town: "Monroe", zip: "10950" })).toBe("twenty one Rovna Court, unit three one two, Monroe New York, one zero nine five zero");
    expect(spokenAddress({ house: "380", street: "Lake Shore Drive", town: "Monroe", zip: "10950", areaPrinted: "Blooming Grove" })).toBe("three hundred eighty Lake Shore Drive, Blooming Grove, Monroe New York, one zero nine five zero");
    expect(spokenName("Rosner", "Usher")).toBe("Rosner, Usher");
  });
});

describe("directory list file (nothing is loaded)", () => {
  it("the 8 columns; 7-digit numbers are 845; shared numbers and bad rows are listed", async () => {
    const { parseDirectoryCsv } = await import("@/lib/directory-list");
    const csv = [
      "Last name,First name,House number,Street,Unit,Town/State/Zip,Phone,Area as printed",
      "Rosner,Usher,29-001,Dallas Drive,,\"Monroe, NY 10950\",238-2784,Monroe",
      "Kleinman,Shimon,380,Lake Shore Drive,,\"Monroe, NY 10950\",2382784,Blooming Grove",
      "Weiss,Chaim,12,Forest Road,302A,\"Monroe, NY 10950\",(845) 555-0101,Kiryas Joel",
      "Broken,Row,,No House,,\"Monroe, NY 10950\",5550102,",
    ].join("\n");
    const r = parseDirectoryCsv(csv);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ lastName: "Rosner", house: "29-001", town: "Monroe", state: "NY", zip: "10950", phone: "+18452382784" });
    expect(r.rows[2]).toMatchObject({ unit: "302A", phone: "+18455550101", areaPrinted: "Kiryas Joel" });
    expect(r.issues).toEqual([{ line: 5, reason: "no house number or street", text: expect.any(String) }]);
    expect(r.sharedPhones).toEqual([{ phone: "+18452382784", names: ["Rosner, Usher, 29-001 Dallas Drive", "Kleinman, Shimon, 380 Lake Shore Drive"] }]);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/admin/(app)/customers/directory/actions.ts", "utf8")).not.toMatch(/db\.insert|db\.update/); // preview only
  });
});

describe("the shared number alert", () => {
  it("an order from 845-238-2784 emails and texts Abraham the name, address, items and date; other numbers send nothing", async () => {
    process.env.ADMIN_EMAIL = "owner@example.com";
    process.env.ADMIN_PHONE = "+18455550000";
    const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
    const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Castle Combo", priceCents: 20000, quantity: 2, active: true, sortOrder: 1 }).returning();
    const [o] = await db.insert(schema.orders).values({ eventDate: "2026-12-22", pickupDate: "2026-12-23", status: "PENDING_PAYMENT", channel: "phone", subtotalCents: 20000 } as never).returning();
    await db.insert(schema.orderItems).values({ orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 20000 } as never);
    const { alertSharedPhoneOrder } = await import("@/lib/shared-phones");
    expect((await alertSharedPhoneOrder({ phone: "+18455551234", name: "Someone", address: "1 Main Street", orderIds: [o.id], source: "phone" })).sent).toBe(0);
    const r = await alertSharedPhoneOrder({ phone: "8452382784", name: "Kleinman, Shimon", address: "380 Lake Shore Drive, Monroe, NY 10950", orderIds: [o.id], source: "staff" });
    expect(r.sent).toBe(2);
    expect(sent.emails[0].to).toBe("owner@example.com");
    expect(sent.emails[0].body).toContain("Kleinman, Shimon");
    expect(sent.emails[0].body).toContain("380 Lake Shore Drive, Monroe, NY 10950");
    expect(sent.emails[0].body).toContain("1 Castle Combo");
    expect(sent.texts[0].to).toBe("+18455550000");
    expect(sent.texts[0].body).toContain("Kleinman, Shimon");
    expect(sent.texts[0].body).toContain("1 Castle Combo");
    const flow = readFile("src/lib/ivr/flow.ts");
    const pos = readFile("src/app/admin/(app)/pos/actions.ts");
    expect(flow).toContain("alertSharedPhoneOrder(");
    expect(pos).toContain("alertSharedPhoneOrder(");
  });
});

describe("step 5 and the new slots", () => {
  it("outside the service area: the approved line, then the star line; keypad words have slots", async () => {
    const { PROMPTS } = await import("@/lib/ivr/prompts");
    expect(PROMPTS.addr_outside.text).toBe("We are sorry, we do not deliver to this area. We deliver only in Orange County, New York. To enter a different zip code, press 1.");
    expect((PROMPTS.addr_outside as { pending?: boolean }).pending).toBeUndefined();
    const { allSlots } = await import("@/lib/recording-slots");
    const slots = allSlots();
    for (const [k, label] of [["word:dot", "Keypad - dot"], ["word:dash", "Keypad - dash"], ["word:underscore", "Keypad - underscore"], ["word:basement", "Word - basement"]]) expect(slots.find((s) => s.key === k)?.label).toBe(label);
    expect(slots.filter((s) => s.kind === "letter")).toHaveLength(26);
  });
});

function readFile(p: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require("node:fs") as typeof import("node:fs")).readFileSync(p, "utf8");
}

describe("read-back joined from recordings (Nov 22, 2026, 11:12 PM)", () => {
  it("house as an amount (21 to 99 one clip), street, unit and its digits, town, zip 10950 as one clip", async () => {
    const { amountSlots, addressSlotKeys } = await import("@/lib/spoken-address");
    expect(amountSlots(53)).toEqual(["word:fifty three"]);
    expect(amountSlots(279)).toEqual(["word:two", "word:hundred", "word:seventy nine"]);
    expect(amountSlots(380)).toEqual(["word:three", "word:hundred", "word:eighty"]);
    expect(amountSlots(12)).toEqual(["word:twelve"]);
    // Hark's 348 streets (Nov 23, 2026): the street as said or as printed; slot named by the spoken name
    expect(addressSlotKeys({ house: "21", street: "Acres Road", unit: "312", town: "Monroe", zip: "10950" })).toEqual(["word:twenty one", "street:acres_road", "word:unit", "word:three", "word:one", "word:two", "town:monroe_new_york", "zip:10950"]);
    expect(addressSlotKeys({ house: "5", street: "ACRES RD", town: "Highland Mills", zip: "10930" })).toEqual(["word:five", "street:acres_road", "town:highland_mills_new_york", "zip:10930"]);
    expect(addressSlotKeys({ house: "5", street: "Nowhere Lane", town: "Monroe", zip: "10950" })).toBeNull(); // not on the list: computer voice
    const { allSlots: slots } = await import("@/lib/recording-slots");
    const streets = slots().filter((s) => s.group === "Streets");
    expect(streets).toHaveLength(348);
    expect(streets[0]).toMatchObject({ key: "street:acres_road", label: "Street - Acres Road", text: "Acres Road" });
    const { allSlots } = await import("@/lib/recording-slots");
    const keys = allSlots().map((s) => s.key);
    for (const k of ["word:twenty one", "word:ninety nine", "word:unit", "zip:10950", "zip:10930", "zip:10918", "zip:10992", "zip:10917", "zip:10926"]) expect(keys, k).toContain(k);
    expect(keys).not.toContain("word:thirty zero");
  });
});
