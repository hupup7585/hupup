import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham's delivery rule (Nov 27, 2026, 1:06-1:17 AM): ONE delivery charge per booking, not per day: the first
   item's zone price plus "Each additional item" ($5.00, Admin) for each more item; the address-saved line names both
   prices for 2 and 3+ items; Box 49 plays after Box 34 for the calling number. */
const h = vi.hoisted(() => ({ kind: "local" as "local" | "area", session: { callSid: "CAdel", fromNumber: "+18455550414", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));
vi.mock("@/lib/delivery-areas", async (orig) => ({
  ...(await orig<typeof import("@/lib/delivery-areas")>()),
  deliveryQuote: async () => (h.kind === "local" ? { ok: true, zone: "Kiryas Joel", feeCents: 1000, kind: "local" } : { ok: true, zone: "Monroe", feeCents: 1500, kind: "area" }),
}));

import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { bookingDeliveryCents, bookingItemCount } from "@/lib/delivery-rule";
import { quoteBooking } from "@/lib/order-pricing";
import { allSlots } from "@/lib/recording-slots";

const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAdel", ...body }, callSid: "CAdel", from: "+18455550414" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'")).join(" ");
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

let p: number[] = [];
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", sortOrder: 1, active: true }).returning();
  p = (await db.insert(schema.products).values([1, 2, 3].map((n) => ({ categoryId: c.id, name: `Castle ${n}`, priceCents: 10000, quantity: 5, active: true }))).returning()).map((x) => x.id);
});
async function cart(days: { date: string; items: number[] }[]) {
  const ids: number[] = [];
  for (const d of days) {
    const [o] = await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: d.date, pickupDate: d.date, subtotalCents: d.items.length * 10000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    await db.insert(schema.orderItems).values(d.items.map((pid) => ({ orderId: o.id, productId: pid, qty: 1, unitPriceCents: 10000 })));
    ids.push(o.id);
  }
  h.session.data = { dayOrderIds: ids, name: "Sara Klein", address: "12 Forest Rd, Monroe, NY 10950", town: "Monroe", phone: "+18455550414", termsAccepted: true };
  return ids;
}

describe("one delivery charge per booking", () => {
  it("the rule: 1 item 2 days KJ = $10; 3 items nearby = $25; KJ 3 items 2 days = $20; Orange County 3 items = $30", () => {
    const s = { deliveryExtraItemCents: "500" };
    expect(bookingDeliveryCents(1000, bookingItemCount([{ productId: 1, qty: 1 }, { productId: 1, qty: 1 }]), s)).toBe(1000);
    expect(bookingDeliveryCents(1500, bookingItemCount([{ productId: 1, qty: 1 }, { productId: 2, qty: 1 }, { productId: 3, qty: 1 }]), s)).toBe(2500);
    expect(bookingDeliveryCents(1000, 3, s)).toBe(2000);
    expect(bookingDeliveryCents(2000, 3, s)).toBe(3000);
    expect(bookingDeliveryCents(0, 3, s)).toBe(0); // free delivery stays free (decision for Abraham)
  });
  it("phone checkout: 1 item on 2 days in KJ is $10 once; box 56's delivery is the whole booking's", async () => {
    h.kind = "local";
    const ids = await cart([{ date: "2027-03-14", items: [p[0]] }, { date: "2027-03-15", items: [p[0]] }]);
    const fx = await call("finalize");
    expect(said(fx)).toMatch(/Your total is/);
    const rows = (await db.select().from(schema.orders).where(inArray(schema.orders.id, ids))).sort((a, b) => a.id - b.id);
    expect(rows.map((r) => r.deliveryFeeCents)).toEqual([1000, 0]);
  });
  it("New booking: 3 items for 1 day nearby is $25", async () => {
    h.kind = "area";
    const q = await quoteBooking({ items: p.map((id) => ({ productId: id, qty: 1 })), eventDate: "2027-03-16", thuSun: false, phone: null, address: "1 Main St, Monroe, NY 10950" });
    expect(q.deliveryCents).toBe(2500);
  });
});

describe("the address-saved delivery line", () => {
  it("1 item: the one price; 2 items: first and second item; 3 items: first and each additional item", async () => {
    h.kind = "local";
    await cart([{ date: "2027-04-10", items: [p[0]] }]);
    expect(said(await call("addr-price"))).toBe("Your delivery address has been saved, delivery to Monroe New York is 10 dollars.");
    await cart([{ date: "2027-04-11", items: [p[0], p[1]] }]);
    expect(said(await call("addr-price"))).toContain("is 10 dollars for the first item, and 5 dollars for the second item.");
    await cart([{ date: "2027-04-12", items: p }]);
    expect(said(await call("addr-price"))).toContain("is 10 dollars for the first item, and 5 dollars for each additional item.");
  });
  it("Hark's three new recording slots", () => {
    const keys = allSlots().map((s) => s.key);
    for (const k of ["addr_saved_price_two#3", "addr_saved_price_two#4", "addr_saved_price_more#4"]) expect(keys, k).toContain(k);
    expect(keys).not.toContain("addr_saved_price_more#3"); // the same "for the first item, and" recording
    expect(allSlots().find((s) => s.key === "addr_saved_price_two#3")!.text).toBe("for the first item, and");
  });
});

describe("Box 49 after Box 34", () => {
  it("a new number hears Box 49; key 1 records consent; an agreed number skips it; a STOP number hears the opted-out line", async () => {
    await cart([{ date: "2027-05-10", items: [p[0]] }]);
    delete h.session.data.phone;
    expect(redirect(await call("directions-choice", { Digits: "#" }))).toBe("sms-consent");
    expect(said(await call("sms-consent"))).toContain("To receive text updates to your phone number, about your reservation, press 1.");
    const yes = await call("sms-consent-answer", { Digits: "1" });
    expect(said(yes)).toContain("Thank you. You will get text updates about your reservation, to 8 4 5, 5 5 5, 0 4 1 4.");
    expect(said(yes)).toContain("Almost done!");
    expect(redirect(yes)).toBe("finalize");
    const consents = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455550414"));
    expect(consents.some((c) => c.scope === "transactional" && c.action === "opt_in")).toBe(true);
    h.session.data.smsConsent = undefined;
    expect(said(await call("sms-consent"))).not.toContain("text updates"); // already agreed: skipped
    await db.insert(schema.customers).values({ name: "Stopped", phone: "+18455550415", smsOptOut: true });
    h.session.data = { ...h.session.data, phone: "+18455550415" };
    expect(said(await call("sms-consent"))).toContain("This number has opted out of our messages.");
  });
});
