import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Payment link prefill (Abraham, Nov 26, 2026, 13:25 ET): the secure card page opens with everything the customer
 * already gave (name, phone, email, delivery address, items, delivery and pickup dates) whichever way the link was
 * made (a phone caller's link, the automatic link, staff in Admin or New booking). Never card data. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { getPaymentGroup, getOrderWithItems, orderNumber } from "@/lib/orders";
import { paymentLink } from "@/lib/sola";
import { prefillFor, splitAddress, splitName } from "@/lib/pay-prefill";

let orderId = 0;
let secondDay = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_PAYMENTSITE_NAME = "hupupattractions";
  const [c] = await db.insert(schema.customers).values({ name: "Klein, Sara", phone: "+18455550133", email: "sara@example.com" }).returning();
  const [cat] = await db.insert(schema.categories).values({ name: "Jumping balloons" }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 15000 }).returning();
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: c.id, eventDate: "2026-12-07", pickupDate: "2026-12-08", deliveryAddress: "12 Forest Road, Unit 3, Monroe, NY 10950", subtotalCents: 15000, totalCents: 16219 }).returning();
  orderId = o.id;
  await db.update(schema.orders).set({ paymentGroupId: o.id }).where((await import("drizzle-orm")).eq(schema.orders.id, o.id));
  const [o2] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", customerId: c.id, eventDate: "2026-12-14", pickupDate: "2026-12-15", deliveryAddress: "12 Forest Road, Unit 3, Monroe, NY 10950", paymentGroupId: o.id, subtotalCents: 15000 }).returning();
  secondDay = o2.id;
  await db.insert(schema.orderItems).values([
    { orderId: o.id, productId: p.id, qty: 1, unitPriceCents: 15000 },
    { orderId: o2.id, productId: p.id, qty: 2, unitPriceCents: 15000 },
  ]);
});

describe("pieces", () => {
  it("names kept as 'Last, First' and as 'First Last'", () => {
    expect(splitName("Klein, Sara")).toEqual({ firstName: "Sara", lastName: "Klein" });
    expect(splitName("Sara Rivka Klein")).toEqual({ firstName: "Sara Rivka", lastName: "Klein" });
    expect(splitName("")).toEqual({});
  });
  it("addresses: street (with the unit), town, state, zip; anything unclear stays in the street", () => {
    expect(splitAddress("12 Forest Road, Unit 3, Monroe, NY 10950")).toEqual({ street: "12 Forest Road, Unit 3", city: "Monroe", state: "NY", zip: "10950" });
    expect(splitAddress("5 Acres Road Kiryas Joel 10950")).toEqual({ street: "5 Acres Road Kiryas Joel 10950", zip: "10950" });
  });
});

describe("the secure card page opens filled in", () => {
  const params = (u: string) => new URL(u).searchParams;
  it("from the order: name, phone, email, billing and delivery address, every day's items and dates", async () => {
    const group = (await getPaymentGroup(orderId))!;
    const link = paymentLink({ orderId, amountCents: group.due, prefill: prefillFor(group.primary, group.orders, `#${orderNumber(orderId)}`) })!;
    const q = params(link);
    expect(q.get("xBillFirstName")).toBe("Sara");
    expect(q.get("xBillLastName")).toBe("Klein");
    expect(q.get("xName")).toBe("Klein, Sara");
    expect(q.get("xEmail")).toBe("sara@example.com");
    expect(q.get("xBillPhone")).toBe("+18455550133");
    expect(q.get("xBillStreet")).toBe("12 Forest Road, Unit 3");
    expect(q.get("xBillCity")).toBe("Monroe");
    expect(q.get("xBillState")).toBe("NY");
    expect(q.get("xBillZip")).toBe("10950");
    expect(q.get("xShipStreet")).toBe("12 Forest Road, Unit 3");
    expect(q.get("xShipZip")).toBe("10950");
    const d = q.get("xDescription")!;
    expect(d).toContain(`Order #${orderNumber(orderId)}`);
    expect(d).toContain("1 x Castle: delivery Monday, December 7, pickup Tuesday, December 8");
    expect(d).toContain("2 x Castle: delivery Monday, December 14, pickup Tuesday, December 15");
  });
  it("never any card data in the link", async () => {
    const group = (await getPaymentGroup(orderId))!;
    const link = paymentLink({ orderId, amountCents: group.due, prefill: prefillFor(group.primary, group.orders) })!;
    expect([...params(link).keys()].filter((k) => /card|cvv|cvc|exp|pan/i.test(k))).toEqual([]);
  });
  it("a single-day order made by staff (New booking): the same fields", async () => {
    const full = (await getOrderWithItems(secondDay))!;
    const q = params(paymentLink({ orderId: secondDay, amountCents: 30000, prefill: prefillFor(full, [full], `#${orderNumber(secondDay)}`) })!);
    expect(q.get("xBillFirstName")).toBe("Sara");
    expect(q.get("xBillZip")).toBe("10950");
    expect(q.get("xDescription")).toContain("2 x Castle");
  });
  it("every way a link is made uses the prefill: the phone caller's link and the automatic link (the pay page), staff (New booking)", () => {
    const page = readFileSync("src/app/pay/[orderId]/page.tsx", "utf8"); // automatic: straight to the card page
    const action = readFileSync("src/app/pay/[orderId]/actions.ts", "utf8"); // a link sent to a phone caller or by email
    const pos = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8"); // staff in Admin New booking
    for (const f of [page, action, pos]) {
      expect(f).toMatch(/paymentLink\(\{[^}]*prefill: prefillFor\(/);
      expect(f).not.toMatch(/paymentLink\(\{[^}]*name: full/);
    }
  });
});
