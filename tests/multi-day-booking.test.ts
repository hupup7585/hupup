import { beforeAll, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

/*
 * Key 1 booking (Abraham, Nov 8, 2026): date first, then items; "For the same day, press 1. For another day, press 2.";
 * several days on one call; one charge for all of them. Runs on an in-memory database; nothing is sent for real.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAmd", fromNumber: "+18455550177", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  sms: [] as { to: string; body: string }[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) =>
    Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => true, lateHoursToday: () => null }));
vi.mock("@/lib/notify", () => ({
  sendSms: async (to: string, body: string) => (h.sms.push({ to, body }), { sent: true }),
  sendEmail: async () => ({ sent: true }),
  sendMessage: async () => ({ sent: true }),
}));

import { handleVoice, handleCallStatus } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { getPaymentGroup } from "@/lib/orders";
import { invoiceFor } from "@/lib/sola";
import { POST as solaWebhook } from "@/app/api/sola/webhook/route";
import { eq, inArray } from "drizzle-orm";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550177" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace("https://hupup.example/api/voice/", "").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&"));

let productId = 0;
const DAY1 = "2026-12-01";
const DAY2 = "2026-12-08";

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.AUTH_SECRET = "test-secret";
  const [cat] = await db.insert(schema.categories).values({ name: "Jumping Balloons", spokenName: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: cat.id, name: "Castle", priceCents: 20000, quantity: 3, active: true, sortOrder: 1 }).returning();
  productId = p.id;
});

describe("key 1: date first, several days, one charge", () => {
  it("asks the date first, then the rental list for that day", async () => {
    expect(redirect(await call("menu-choice", { Digits: "1" }))).toBe("book");
    expect(redirect(await call("book"))).toBe("date"); // no day yet: the date comes first
    expect(said(await call("date"))[0]).toMatch(/^What day is your party\?/);
    expect(redirect(await call("date-confirm", { Digits: "1" }, `d=${DAY1}`))).toBe("book");
    expect(h.session.data.day).toBe(DAY1);
    expect(said(await call("book"))).toContain("To go to your shopping cart, press 0.");
  });

  it("after an item: Abraham's two lines; 1 = same day, 2 = another day", async () => {
    expect(redirect(await call("product-choice", { Digits: "2" }, `p=${productId}`))).toBe(`qty?p=${productId}&d=${DAY1}`);
    const added = said(await call("add", {}, `p=${productId}&d=${DAY1}&q=1`));
    expect(added).toContain("For the same day, press 1. For another day, press 2.");
    expect(added).toContain("To go to your shopping cart, press 0.");
    expect(redirect(await call("after-add", { Digits: "1" }))).toBe("book");
    expect(redirect(await call("after-add", { Digits: "0" }))).toBe("cart");
    expect(redirect(await call("after-add", { Digits: "2" }))).toBe("date");
    // another day: a new held order for that day
    expect(redirect(await call("date-confirm", { Digits: "1" }, `d=${DAY2}`))).toBe("book");
    expect(h.session.orderId).toBeNull();
    await call("add", {}, `p=${productId}&d=${DAY2}&q=2`);
    // back to the first day: more items join that day's order
    await call("date-confirm", { Digits: "1" }, `d=${DAY1}`);
    await call("add", {}, `p=${productId}&d=${DAY1}&q=1`);
    const held = await db.select().from(schema.orders).where(eq(schema.orders.status, "HOLD"));
    expect(held.map((o) => o.eventDate).sort()).toEqual([DAY1, DAY2]);
    expect((h.session.data.dayOrderIds as number[]).length).toBe(2);
  });

  it("the cart reads every day, then one rental total", async () => {
    const lines = said(await call("cart"));
    expect(lines[0]).toBe("Here's your cart.");
    expect(lines).toContain("For Tuesday, December 1: 2 Castle.");
    expect(lines).toContain("For Tuesday, December 8: 2 Castle.");
    expect(lines).toContain("Your rental total is 800 dollars, plus delivery and sales tax.");
  });

  it("checkout: one payment link for all days; the pay page and Sola charge the combined total; one payment confirms every day", async () => {
    Object.assign(h.session.data, { name: "Sample Caller", address: "12 Forest Road Kiryas Joel", phone: "+18455550177", smsConsent: "existing", termsAccepted: true });
    const xml = await call("finalize");
    expect(said(xml).join(" ")).toMatch(/Your total is/);
    const pending = await db.select().from(schema.orders).where(eq(schema.orders.status, "PENDING_PAYMENT"));
    expect(pending).toHaveLength(2);
    const primary = pending.find((o) => o.eventDate === DAY1)!;
    expect(pending.every((o) => o.paymentGroupId === primary.id)).toBe(true);
    const group = await getPaymentGroup(primary.id);
    const sum = pending.reduce((n, o) => n + (o.totalCents ?? 0), 0);
    expect(group!.due).toBe(sum);
    // one text with both days and one link
    const text = h.sms.find((m) => m.body.includes("order #"))!;
    expect(text.body).toContain("Tuesday, December 1");
    expect(text.body).toContain("Tuesday, December 8");
    expect(text.body.match(/\/pay\/\d+\?t=/g)).toHaveLength(1);
    // one Sola payment for the combined total confirms both days
    process.env.SOLA_WEBHOOK_PIN = "pin";
    const fields = { xResult: "A", xInvoice: invoiceFor(primary.id), xAuthAmount: (sum / 100).toFixed(2), xRefNum: "REFMD" };
    const lowered = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : 1));
    const sig = crypto.createHash("md5").update(lowered.map(([, v]) => v).join("") + "pin").digest("hex");
    const res = await solaWebhook(new Request("https://hupup.example/api/sola/webhook", { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "ck-signature": sig } }));
    expect(res.status).toBe(200);
    const after = await db.select().from(schema.orders).where(inArray(schema.orders.id, pending.map((o) => o.id)));
    expect(after.every((o) => o.status === "CONFIRMED")).toBe(true);
    expect(after.reduce((n, o) => n + o.paidCents, 0)).toBe(sum);
    expect(h.sms.some((m) => m.body.includes("You're all set for Tuesday, December 1 and Tuesday, December 8!"))).toBe(true);
  });

  it("hanging up releases every held day on the call", async () => {
    Object.assign(h.session, { callSid: "CAmd2", orderId: null, data: {} });
    await call("date-confirm", { Digits: "1" }, `d=${DAY1}`);
    await call("add", {}, `p=${productId}&d=${DAY1}&q=1`);
    await call("date-confirm", { Digits: "1" }, `d=${DAY2}`);
    await call("add", {}, `p=${productId}&d=${DAY2}&q=1`);
    const ids = h.session.data.dayOrderIds as number[];
    expect(ids).toHaveLength(2);
    await handleCallStatus("CAmd2", "completed");
    const rows = await db.select().from(schema.orders).where(inArray(schema.orders.id, ids));
    expect(rows.every((o) => o.status === "CANCELLED")).toBe(true);
  });
});
