import { beforeAll, describe, expect, it, vi } from "vitest";

/* New booking (Admin POS), Nov 24, 2026: the live total on screen is what the saved booking costs, to the cent. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
const who = vi.hoisted(() => ({ role: "owner" as "owner" | "secretary" }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: who.role }), requireOwner: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendOrderText: async () => ({ texted: true, emailed: false, message: "" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createBookingAction, directorySuggestAction, quoteAction } from "@/app/admin/(app)/pos/actions";
import { loadDirectory } from "@/lib/directory";
import { parseDirectoryCsv } from "@/lib/directory-list";

let castle = 0;
let combo = 0;
const DATE = "2026-12-15"; // a Tuesday
const base = { name: "Sara Klein", email: "", deliveryTime: "", notes: "", termsVia: "phone", amountPaid: "" };

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  castle = (await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", priceCents: 18999, quantity: 5, active: true }).returning())[0].id;
  combo = (await db.insert(schema.products).values({ categoryId: c.id, name: "Castle Combo", priceCents: 22550, quantity: 5, active: true }).returning())[0].id;
});

describe("live total on the booking screen", () => {
  it("items, delivery, sales tax and total match the saved booking to the cent", async () => {
    const items = { [castle]: 2, [combo]: 1 };
    const q = await quoteAction({ date: DATE, items, phone: "845-555-0144", address: "12 Forest Road, Monroe", thuSun: false });
    expect(q).toBeTruthy();
    expect(q!.itemsCents).toBe(2 * 18999 + 22550);
    expect(q!.problem).toBeNull();
    expect(q!.deliveryCents).toBeGreaterThan(0);
    expect(q!.taxCents).toBeGreaterThan(0);
    expect(q!.totalCents).toBe(q!.subtotalCents + q!.deliveryCents! + q!.taxCents!);
    const r = await createBookingAction({ ...base, date: DATE, items, phone: "845-555-0144", address: "12 Forest Road, Monroe", payment: "later" });
    expect(r.ok).toBe(true);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId!));
    expect({ sub: o.subtotalCents, del: o.deliveryFeeCents, tax: o.taxCents, total: o.totalCents }).toEqual({ sub: q!.subtotalCents, del: q!.deliveryCents, tax: q!.taxCents, total: q!.totalCents });
  });

  it("changes as soon as an item or the address changes", async () => {
    const one = await quoteAction({ date: DATE, items: { [castle]: 1 }, phone: "", address: "12 Forest Road, Monroe", thuSun: false });
    const two = await quoteAction({ date: DATE, items: { [castle]: 2 }, phone: "", address: "12 Forest Road, Monroe", thuSun: false });
    expect(two!.itemsCents - one!.itemsCents).toBe(18999);
    expect(two!.totalCents!).toBeGreaterThan(one!.totalCents!);
  });

  it("an address that cannot be priced: the reason, no total (and so no payment link)", async () => {
    const none = await quoteAction({ date: DATE, items: { [castle]: 1 }, phone: "", address: "", thuSun: false });
    expect(none!.totalCents).toBeNull();
    expect(none!.problem).toBe("Add the delivery address first (house number, street, town and ZIP).");
  });
});

describe("address from the Directory list (Nov 24, 2026)", () => {
  beforeAll(async () => {
    const csv = [
      "Yiddish last name,Yiddish first name,last name,first name,house number,street,unit,town/state/zip,phone,area as printed",
      'שווארץ,אברהם,Schwartz,Abraham,12,FOREST RD,,"Monroe, NY 10950",845-555-0301,',
      'קליין,שרה,Klein,Sara,41,CENTRAL VALLEY LINE,,"Highland Mills, NY 10930",845-555-0302,WOODBURY JUNCTION',
      'ראזנער,אשר,Rosner,Usher,29,DALLAS DR,001,"Monroe, NY 10950",845-238-2784,',
      'קליינמאן,שמעון,Kleinman,Shimon,380,LAKE SHORE DR,,"Monroe, NY 10950",845-238-2784,Blooming Grove',
    ].join("\n");
    await loadDirectory(parseDirectoryCsv(csv).rows);
  });
  it("a phone number, a name or a street finds the entries; a pick gives name, phone and the full address", async () => {
    const byPhone = await directorySuggestAction("845-555-0301");
    expect(byPhone).toHaveLength(1);
    expect(byPhone[0]).toMatchObject({ lastName: "Schwartz", firstName: "Abraham", address: "12 Forest Road, Monroe, NY 10950", shared: false });
    const byName = await directorySuggestAction("Klein Sara");
    expect(byName.map((h) => h.address)).toEqual(["41 Central Valley Line, Highland Mills, NY 10930"]);
    expect((await directorySuggestAction("forest")).map((h) => h.lastName)).toEqual(["Schwartz"]);
    expect((await directorySuggestAction("Schw")).length).toBe(1);
  });
  it("a shared number shows both families, marked shared", async () => {
    const both = await directorySuggestAction("2382784");
    expect(both.map((h) => `${h.lastName}, ${h.firstName}`).sort()).toEqual(["Kleinman, Shimon", "Rosner, Usher"]);
    expect(both.every((h) => h.shared)).toBe(true);
    expect(both.find((h) => h.lastName === "Rosner")?.address).toBe("29 Dallas Drive, unit 001, Monroe, NY 10950");
  });
  it("a picked Monroe address is priced right away: delivery and tax on screen", async () => {
    const [h] = await directorySuggestAction("845-555-0301");
    const q = await quoteAction({ date: DATE, items: { [castle]: 1 }, phone: h.phone!, address: h.address, thuSun: false });
    expect(q!.problem).toBeNull();
    expect(q!.deliveryCents).toBeGreaterThan(0);
    expect(q!.totalCents).toBe(q!.subtotalCents + q!.deliveryCents! + q!.taxCents!);
  });
  it("Owner only, like the Directory list: the Secretary gets no suggestions", async () => {
    who.role = "secretary";
    expect(await directorySuggestAction("845-555-0301")).toEqual([]);
    who.role = "owner";
  });
});


describe("Highland Mills address priced on screen", () => {
  it("shows a delivery price or the reason it cannot be priced (never a silent total)", async () => {
    const [h] = await directorySuggestAction("Klein Sara");
    const q = await quoteAction({ date: DATE, items: { [castle]: 1 }, phone: h.phone!, address: h.address, thuSun: false });
    expect(q!.totalCents !== null || Boolean(q!.problem)).toBe(true);
    console.log("Highland Mills quote:", JSON.stringify({ delivery: q!.deliveryCents, tax: q!.taxCents, total: q!.totalCents, problem: q!.problem }));
  });
});

describe("credit card by staff (Nov 24, 2026)", () => {
  it("books, then gives Sola's secure card page for the full total; the card never touches our server", async () => {
    process.env.SOLA_PAYMENTSITE_NAME = "hupupattractions";
    const q = await quoteAction({ date: DATE, items: { [castle]: 1 }, phone: "845-555-0150", address: "12 Forest Road, Monroe", thuSun: false });
    const r = await createBookingAction({ ...base, date: DATE, items: { [castle]: 1 }, phone: "845-555-0150", address: "12 Forest Road, Monroe", payment: "card" });
    expect(r.ok).toBe(true);
    const u = new URL(r.cardUrl!);
    expect(u.host).toBe("secure.cardknox.com");
    expect(u.searchParams.get("xAmount")).toBe((q!.totalCents! / 100).toFixed(2));
    expect(r.cardCents).toBe(q!.totalCents);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId!));
    expect(o.status).toBe("PENDING_PAYMENT"); // paid only when Sola's webhook approves it
    delete process.env.SOLA_PAYMENTSITE_NAME;
  });
  it("without the Sola page name: not booked, and says why", async () => {
    process.env.VERCEL = "1";
    const r = await createBookingAction({ ...base, date: DATE, items: { [castle]: 1 }, phone: "", address: "12 Forest Road, Monroe", payment: "card" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/SOLA_PAYMENTSITE_NAME/);
    delete process.env.VERCEL;
  });
});

describe("Chanukah and Chol Hamoed on the booking calendar (Nov 24, 2026)", () => {
  it("those days are marked for the light blue; the days before and after are not", async () => {
    const { calendarFor } = await import("@/app/admin/(app)/pos/actions");
    const days = await calendarFor("2026-12-01", 20);
    const week = (iso: string) => days.find((d) => d.date === iso)?.holidayWeek ?? null;
    expect(week("2026-12-08")).toBe("chanukah");
    expect(week("2026-12-01")).toBeNull();
    expect(week("2026-12-15")).toBeNull();
    const pesach = await calendarFor("2027-04-24", 3);
    expect(pesach.some((d) => d.holidayWeek === "cholHamoed")).toBe(true);
  });
});

describe("Admin bugs (Nov 24, 2026)", () => {
  it("Deliveries 1: no booking with an address that can't be priced, even cash or check", async () => {
    for (const payment of ["cash", "check", "later"] as const) {
      const r = await createBookingAction({ ...base, date: DATE, items: { [castle]: 1 }, phone: "", address: "14 D A Weuder #201", payment, amountPaid: "300.00" });
      expect(r.ok, payment).toBe(false);
      expect(r.message).toMatch(/^Not booked\./);
    }
  });
  it("Inbox 2: the voicemail page never shows the default box password", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/admin/(app)/voicemail/page.tsx", "utf8")).not.toMatch(/1234/);
  });
  it("Deliveries 2: an impossible date falls back to today instead of crashing", async () => {
    const { isValidISO } = await import("@/lib/dates");
    expect(isValidISO("2026-13-45")).toBe(false);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/app/admin/deliveries/page.tsx", "utf8")).toContain("sp.d && isValidISO(sp.d) ? sp.d : todayISO()");
  });
});

describe("cash or check taken at New booking (Hark's Admin list 1-3, Nov 26, 2026)", () => {
  it("paid in full: confirmed and in Bookkeeping; paid less: Needs attention, also in Bookkeeping", async () => {
    const q = await quoteAction({ date: DATE, items: { [castle]: 1 }, phone: "845-555-0161", address: "12 Forest Road, Monroe", thuSun: false });
    const full = await createBookingAction({ ...base, date: DATE, items: { [castle]: 1 }, phone: "845-555-0161", address: "12 Forest Road, Monroe", payment: "cash", amountPaid: (q!.totalCents! / 100).toFixed(2) });
    expect(full.ok).toBe(true);
    const [a] = await db.select().from(schema.orders).where(eq(schema.orders.id, full.orderId!));
    expect([a.status, a.paidCents, a.paymentMethod]).toEqual(["CONFIRMED", q!.totalCents, "cash"]);
    const booksA = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, full.orderId!));
    expect(booksA.length).toBeGreaterThan(0);
    const short = await createBookingAction({ ...base, date: DATE, items: { [castle]: 1 }, phone: "845-555-0162", address: "12 Forest Road, Monroe", payment: "check", amountPaid: "50.00" });
    const [b] = await db.select().from(schema.orders).where(eq(schema.orders.id, short.orderId!));
    expect([b.status, b.paidCents]).toEqual(["NEEDS_ATTENTION", 5000]);
    expect((await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, short.orderId!))).length).toBeGreaterThan(0);
  });

  it("deep check A1: priced before the payment: the items only is Needs attention; full is delivery + tax, never a tip", async () => {
    const q = await quoteAction({ date: "2026-12-16", items: { [castle]: 1 }, phone: "845-555-0163", address: "12 Forest Road, Monroe", thuSun: false });
    const itemsOnly = await createBookingAction({ ...base, date: "2026-12-16", items: { [castle]: 1 }, phone: "845-555-0163", address: "12 Forest Road, Monroe", payment: "cash", amountPaid: "189.99" });
    const [a] = await db.select().from(schema.orders).where(eq(schema.orders.id, itemsOnly.orderId!));
    expect(a.totalCents).toBe(q!.totalCents);
    expect(a.status).toBe("NEEDS_ATTENTION");
    const full = await createBookingAction({ ...base, date: "2026-12-16", items: { [castle]: 1 }, phone: "845-555-0164", address: "12 Forest Road, Monroe", payment: "check", amountPaid: (q!.totalCents! / 100).toFixed(2) });
    const entries = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.orderId, full.orderId!));
    expect(entries.reduce((s, e) => s + (e.tipCents ?? 0), 0)).toBe(0);
    expect(entries.reduce((s, e) => s + (e.taxCents ?? 0), 0)).toBe(q!.taxCents);
    expect(entries.some((e) => e.taxExempt)).toBe(false);
  });
});
