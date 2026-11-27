import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Extra check HQ (Nov 27, 2026): units, Calendar, catalog builder, API keys, search. In-memory database. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string) => (h.emails.push({ to, subject }), { sent: true }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addDays, todayISO } from "@/lib/dates";

const owner = { userId: 1, role: "owner" as const };
let cat = 0;
beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret-for-keys-0123456789";
  process.env.ADMIN_EMAIL = "owner@example.com";
  cat = (await db.insert(schema.categories).values({ name: "Castles HQ", sortOrder: 1, active: true }).returning())[0].id;
});
const product = async (name: string, quantity: number) => (await db.insert(schema.products).values({ categoryId: cat, name, priceCents: 10000, quantity, active: true }).returning())[0].id;
const order = async (status: string, productId: number, day: string, qty = 1) => {
  const [o] = await db.insert(schema.orders).values({ status, channel: "POS", eventDate: day, pickupDate: addDays(day, 1), subtotalCents: 10000 } as never).returning();
  await db.insert(schema.orderItems).values({ orderId: o.id, productId, qty, unitPriceCents: 10000 });
  return o.id;
};

describe("HQ1: Needs attention orders are on the Calendar day", () => {
  it("runsForDay lists them", async () => {
    const p = await product("Castle HQ1", 3);
    const day = addDays(todayISO(), 10);
    const id = await order("NEEDS_ATTENTION", p, day);
    const { runsForDay } = await import("@/lib/admin-queries");
    const rows = (await runsForDay(day)) as { id: number }[];
    expect(rows.some((r) => r.id === id)).toBe(true);
  });
});

describe("HQ3 + HQ8: units", () => {
  it("adding units gives upcoming bookings a unit and reports the ones still without one", async () => {
    const p = await product("Castle HQ3", 5);
    const day = addDays(todayISO(), 9);
    const a = await order("CONFIRMED", p, day);
    const b = await order("CONFIRMED", p, day);
    const { addUnit } = await import("@/lib/units");
    const u1 = await addUnit({ productId: p, code: "HQ3-01" }, owner);
    expect(u1.missingUnits.length).toBeGreaterThan(0); // the second booking (each of its days)
    expect(u1.missingUnits.every((m) => m.startsWith(`order #${1000 + b}`))).toBe(true);
    const u2 = await addUnit({ productId: p, code: "HQ3-02" }, owner);
    expect(u2.missingUnits).toEqual([]);
    const booked = await db.select().from(schema.unitBookings);
    expect(booked.filter((x) => x.orderId === a).length).toBeGreaterThan(0);
    expect(booked.filter((x) => x.orderId === b).length).toBeGreaterThan(0);
  });
  it("two status changes at once move a unit's bookings once", async () => {
    const p = await product("Castle HQ8", 1);
    const day = addDays(todayISO(), 12);
    const { addUnit, setUnitStatus } = await import("@/lib/units");
    const u = await addUnit({ productId: p, code: "HQ8-01" }, owner);
    await addUnit({ productId: p, code: "HQ8-02" }, owner);
    await addUnit({ productId: p, code: "HQ8-03" }, owner);
    const o = await order("CONFIRMED", p, day);
    const { assignUnits } = await import("@/lib/units");
    await assignUnits(o, { quiet: true });
    const mine = await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, o));
    const onUnit = mine.find((x) => x.unitId === u.id) ? u.id : mine[0].unitId;
    await Promise.all([setUnitStatus(onUnit, "damaged", "test", owner), setUnitStatus(onUnit, "damaged", "test", owner)]);
    const after = await db.select().from(schema.unitBookings).where(eq(schema.unitBookings.orderId, o));
    const perDay = new Map<string, number>();
    for (const x of after) perDay.set(x.day, (perDay.get(x.day) ?? 0) + 1);
    expect([...perDay.values()].every((n) => n === 1)).toBe(true);
  });
});

describe("HQ6: an item switched off stays on orders that already have it", () => {
  it("the order's own re-check keeps it", async () => {
    const p = await product("Castle HQ6", 2);
    const day = addDays(todayISO(), 11);
    const id = await order("CONFIRMED", p, day);
    await db.update(schema.products).set({ active: false }).where(eq(schema.products.id, p));
    const { recheckOrderLines } = await import("@/lib/recheck-lines");
    const gone = await db.transaction(async (tx) => recheckOrderLines(tx as never, { id, eventDate: day, pickupDate: addDays(day, 1) }));
    expect(gone).toEqual([]);
  });
});

describe("HQ4 + HQ10: API keys", () => {
  it("20 wrong passwords at once: no more than 5 are checked, and the page locks", async () => {
    const k = await import("@/lib/api-keys");
    await k.requestSetupCode({ userId: 1 });
    const code = h.emails.at(-1)!.subject.match(/(\d{6})$/)![1];
    expect((await k.setPagePassword("correct horse battery", code, { userId: 1 })).ok).toBe(true);
    await Promise.all(Array.from({ length: 20 }, () => k.checkPagePassword("wrong wrong wrong", { userId: 1 })));
    const log = await k.keysLog(200);
    expect(log.filter((r) => r.action === "failed_password").length).toBeLessThanOrEqual(5);
    expect(await k.lockedUntil()).not.toBeNull();
  });
  it("the site's own settings can't be saved as keys", async () => {
    const k = await import("@/lib/api-keys");
    for (const n of ["DATABASE_URL", "AUTH_SECRET", "KEYS_SECRET", "VERCEL_API_TOKEN", "NEXT_PUBLIC_X"]) expect(k.protectedKeyName(n), n).toBe(true);
    expect(k.protectedKeyName("STRIPE_READ_KEY")).toBe(false);
    await expect(k.saveKey({ name: "DATABASE_URL", service: "x", purpose: "", mode: "live", value: "postgres://x/y" }, { userId: 1 })).rejects.toThrow(/website's own settings/);
  });
});

describe("HQ2, HQ5, HQ7, HQ9: code checks", () => {
  it("catalog save follows units, double adds, whole numbers; keys setup needs an open page; search q array", () => {
    const cat = readFileSync("src/app/admin/(app)/catalog/actions.ts", "utf8");
    expect(cat).toContain("syncQuantity(id)");
    expect(cat).toContain("isUniqueViolation(e)");
    expect(cat).toContain("Number.isInteger(ivrDigit)");
    expect(readFileSync("src/app/admin/(app)/keys/actions.ts", "utf8")).toContain("setupAllowed(w)");
    expect(readFileSync("src/app/admin/(app)/search/page.tsx", "utf8")).toContain("Array.isArray(raw) ? raw[0] : raw");
  });
});
