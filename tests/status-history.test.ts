import { describe, expect, it, vi } from "vitest";

/* Booking status history (Abraham, Nov 15, 2026): every change saved by the database, with who and why when known. */

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cancelHold, releaseExpired, setOrderStatus } from "@/lib/orders";
import { statusHistory } from "@/lib/status-history";

const newOrder = async (extra: Record<string, unknown> = {}) =>
  (await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", eventDate: "2099-05-01", pickupDate: "2099-05-01", ...extra }).returning())[0].id;
const steps = async (id: number) => (await statusHistory(id)).map(({ h }) => [h.fromStatus, h.toStatus, h.reason]);

describe("booking status history", () => {
  it("the database saves every change, even ones made without a reason; reasons and staff are added when known", async () => {
    const [staff] = await db.insert(schema.adminUsers).values({ name: "Sara", role: "secretary", phone: "+18455550404" }).returning();
    const id = await newOrder();
    await db.update(schema.orders).set({ status: "PENDING_PAYMENT" }).where(eq(schema.orders.id, id)); // no reason given
    await setOrderStatus(id, "CANCELLED", {}, { reason: "Customer changed plans", userId: staff.id });
    expect(await steps(id)).toEqual([
      [null, "HOLD", null],
      ["HOLD", "PENDING_PAYMENT", null],
      ["PENDING_PAYMENT", "CANCELLED", "Customer changed plans"],
    ]);
    expect((await statusHistory(id)).at(-1)!.who).toBe("Sara");
  });
  it("an update that keeps the same status adds nothing", async () => {
    const id = await newOrder();
    await db.update(schema.orders).set({ notes: "x", status: "HOLD" }).where(eq(schema.orders.id, id));
    expect(await steps(id)).toHaveLength(1);
  });
  it("released holds say why", async () => {
    const a = await newOrder();
    await cancelHold(a);
    expect((await steps(a)).at(-1)![2]).toBe("Cart emptied (the caller hung up or left the cart)");
    const b = await newOrder({ status: "PENDING_PAYMENT", holdExpiresAt: new Date(Date.now() - 60_000) });
    await releaseExpired();
    expect((await steps(b)).at(-1)).toEqual(["PENDING_PAYMENT", "CANCELLED", "Hold ended: the time ran out before payment"]);
  });
  it("Admin: cancelling needs a reason; the order page shows the history; the hold end is shown on the order and the list", () => {
    const actions = readFileSync("src/app/admin/(app)/orders/actions.ts", "utf8");
    expect(actions).toContain('if (status === "CANCELLED" && !why) return { ok: false, message: "Please write the reason for cancelling." };');
    expect(readFileSync("src/app/admin/(app)/orders/[id]/page.tsx", "utf8")).toContain("data-status-history");
    expect(readFileSync("src/app/admin/(app)/orders/[id]/OrderActions.tsx", "utf8")).toContain("Hold ends at");
    expect(readFileSync("src/app/admin/(app)/orders/page.tsx", "utf8")).toContain("Hold ends");
  });
});
