import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham, Nov 26, 2026, 8:34 PM (urgent): staff can book Mutze Shabbes every week on New booking; the phone does not
 * change; nothing can be booked during Shabbes itself. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
const clock = vi.hoisted(() => ({ now: new Date("2027-01-06T17:00:00Z") })); // a Wednesday, noon in New York
vi.mock("@/lib/clock", async (orig) => ({ ...(await orig<typeof import("@/lib/clock")>()), calendarNow: () => clock.now }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: "owner" }), requireOwner: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }), sendOrderText: async () => ({ texted: true, emailed: false, message: "" }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { calendarFor, checkDateFor, createBookingAction } from "@/app/admin/(app)/pos/actions";
import { shabbesEndsAt, staffMutze } from "@/lib/staff-mutze";
import { checkEventDate } from "@/lib/jewish-calendar";
import { holidayWeek } from "@/lib/holiday-rentals";
import { getSettings, saveSetting, clearSettingsCache, SETTING_DEFAULTS } from "@/lib/settings";

const SAT = "2027-01-09"; // a plain Shabbes, not Chanukah or Chol Hamoed
const base = { name: "Sara Klein", email: "", deliveryTime: "", notes: "", termsVia: "phone", amountPaid: "", phone: "845-555-0144", address: "12 Forest Road, Monroe" };
let castle = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  castle = (await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", priceCents: 18999, quantity: 1, active: true }).returning())[0].id;
});

describe("Mutze Shabbes by staff, every week", () => {
  it("the setting is on by default and explained", () => {
    expect(SETTING_DEFAULTS.staffMutzeEveryWeek).toBe(true);
    expect(readFileSync("src/lib/config-explanations.ts", "utf8")).toContain("staffMutzeEveryWeek: {");
  });
  it("a regular Saturday: delivery 2 and a half hours after Shabbes ends, pickup Sunday 9:00 AM", async () => {
    expect(holidayWeek(SAT)).toBeNull();
    const m = staffMutze(SAT, (await getSettings()) as never);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.pickupDate).toBe("2027-01-10");
    expect(m.deliveryAt.getTime() - shabbesEndsAt(SAT, (await getSettings()) as never).getTime()).toBe(150 * 60_000);
    expect(m.pickupLabel).toBe("Sunday 9:00 AM");
    expect(m.days).toBe(1);
  });
  it("New booking shows it clearly on the date and on the calendar", async () => {
    const c = await checkDateFor(SAT);
    expect(c?.ok).toBe(true);
    expect(c?.mutze?.deliveryLabel).toMatch(/^Mutze Shabbes, delivery from \d{1,2}:\d{2} PM$/);
    expect(c?.pickup).toBe("2027-01-10");
    const days = await calendarFor("2027-01-04", 7);
    expect(days.find((d) => d.date === SAT)?.mutze).toBe(true);
    expect(days.find((d) => d.date === "2027-01-05")?.mutze).toBeUndefined();
  });
  it("the booking saves: Saturday to Sunday, one day's price, the delivery time on the order", async () => {
    const r = await createBookingAction({ ...base, date: SAT, items: { [castle]: 1 }, payment: "later" });
    expect(r.ok, r.message).toBe(true);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId!));
    expect(o.eventDate).toBe(SAT);
    expect(o.pickupDate).toBe("2027-01-10");
    expect(o.subtotalCents).toBe(18999);
    expect(o.deliveryTime).toMatch(/^Mutze Shabbes, delivery from/);
  });
  it("the unit is then taken for that Saturday night (only 1 in stock)", async () => {
    const r = await createBookingAction({ ...base, date: SAT, items: { [castle]: 1 }, payment: "later" });
    expect(r.ok).toBe(false);
  });
  it("the phone system does not offer it: the date stays closed there", async () => {
    expect(checkEventDate(SAT, (await getSettings()) as never).ok).toBe(false);
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toContain("staff-mutze");
  });
  it("never during Shabbes itself: a booking made on Shabbes afternoon is refused", async () => {
    clock.now = new Date("2027-01-09T19:00:00Z"); // 2 PM on Shabbes
    const r = await createBookingAction({ ...base, date: "2027-01-16", items: { [castle]: 1 }, payment: "later" });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/closed on Shabbes/);
    clock.now = new Date("2027-01-06T17:00:00Z");
  });
  it("switched off: a Saturday is closed on New booking again", async () => {
    await saveSetting("staffMutzeEveryWeek", false, null);
    clearSettingsCache();
    expect((await checkDateFor("2027-01-16"))?.ok).toBe(false);
    await saveSetting("staffMutzeEveryWeek", true, null);
    clearSettingsCache();
  });
});
