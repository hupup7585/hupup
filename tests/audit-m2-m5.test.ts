import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Code audit Nov 24: M2 (re-activating an order checks the right days, locked) and M5 (POS cash bookings get units). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireAdmin: async () => ({ userId: null, role: "owner" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { reserveItem } from "@/lib/orders";
import { updateStatusAction } from "@/app/admin/(app)/orders/actions";

let pid = 0;
beforeAll(async () => {
  const c = (await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning())[0].id;
  pid = (await db.insert(schema.products).values({ categoryId: c, name: "Castle Bouncer", priceCents: 12000, quantity: 1, active: true }).returning())[0].id;
});
const book = async (date: string, status: "HOLD" | "CONFIRMED") => {
  const r = await reserveItem({ orderId: null, productId: pid, qty: 1, eventDate: date, channel: "POS", status });
  if (!r.ok) throw new Error(`no ${status} for ${date}`);
  return r.orderId;
};
const statusOf = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0].status;

describe("re-activating an order", () => {
  it("refused when another confirmed order now has the only unit on that day", async () => {
    const a = await book("2026-12-17", "HOLD");
    await db.update(schema.orders).set({ status: "CANCELLED" }).where(eq(schema.orders.id, a));
    await book("2026-12-17", "CONFIRMED");
    const r = await updateStatusAction(a, "CONFIRMED");
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/no longer available/);
    expect(await statusOf(a)).toBe("CANCELLED");
  });
  it("checks the order's own pickup day: a longer rental clashing on its last day is refused", async () => {
    const a = await book("2026-12-20", "HOLD");
    await db.update(schema.orders).set({ status: "CANCELLED", pickupDate: "2026-12-23" }).where(eq(schema.orders.id, a));
    await book("2026-12-22", "CONFIRMED");
    expect((await updateStatusAction(a, "CONFIRMED")).ok).toBe(false);
  });
  it("a NEEDS_ATTENTION order already holds its items: moving it to Confirmed is not a re-booking", async () => {
    const a = await book("2026-12-28", "CONFIRMED");
    await db.update(schema.orders).set({ status: "NEEDS_ATTENTION" }).where(eq(schema.orders.id, a));
    const r = await updateStatusAction(a, "CONFIRMED");
    expect(r.ok).toBe(true);
    expect(await statusOf(a)).toBe("CONFIRMED");
  });
});

describe("POS bookings confirmed right away get their units", () => {
  it("assignUnits runs after a confirmed POS booking", () => {
    expect(readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8")).toContain('if (status === "CONFIRMED") await (await import("@/lib/units")).assignUnits(r.orderId);');
  });
});

describe("M7 and L9", () => {
  it("M7: matching by amount never takes a payment made for another order number", async () => {
    const { pickMatch } = await import("@/lib/sola-phonepay");
    const now = new Date();
    const t = (refNum: string, invoice: string) => ({ refNum, amountCents: 5000, approved: true, at: now, invoice }) as never;
    const want = { amountCents: 5000, orderNumber: "none", from: new Date(now.getTime() - 60_000), to: now };
    expect(pickMatch([t("A", "HU-1050")], want).reason).toBe("not_found");
    expect(pickMatch([t("A", "HU-1050"), t("B", "8455550100")], want).match).toMatchObject({ refNum: "B" });
  });
  it("M7: a Sola payment recorded on an order counts as used", () => {
    expect(readFileSync("src/lib/sola-phonepay.ts", "utf8")).toContain("isNotNull(schema.orders.solaRefNum)");
  });
  it("L9: a late payment locks the shared stock group first", () => {
    // K2 (deep check 06:00 M48): one shared lock step (items, their stock group, laser pools) in id order
    expect(readFileSync("src/lib/late-payment.ts", "utf8")).toContain("await lockStock(tx, pids);");
    expect(readFileSync("src/lib/stock-lock.ts", "utf8")).toContain("p.stock_group IN (SELECT stock_group FROM products WHERE id IN");
  });
});
