import { beforeAll, describe, expect, it, vi } from "vitest";

/* Extra check E (Nov 27, 2026): public website and API routes. In-memory database. */
const h = vi.hoisted(() => ({ ip: "198.51.100.9", texts: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": h.ip, "user-agent": "UA", referer: "https://hupupattractions.com/" }),
}));
vi.mock("@/lib/sms-reenroll", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms-reenroll")>()),
  requestPromoByCustomer: async (phone: string) => (h.texts.push(phone), { sent: true, reason: "sent" }),
}));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { signUpForTexts } from "@/app/text-alerts/actions";
import { catalogEmailedToday } from "@/lib/catalog-request";
import { catalogTextedToday, handleCatalogEmail, replyToCatalogText } from "@/lib/catalog-send";
import { handleSmsStatus, smsStatusRank } from "@/lib/sms-inbound";
import { receiveRawPiece } from "@/lib/inbox";
import { saveSetting } from "@/lib/settings";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
});

describe("E1, E2, E10: text-alerts sign-up", () => {
  it("E2: international numbers are refused with the usual message", async () => {
    const r = await signUpForTexts({}, form({ phone: "+44 7700 900123", marketing: "on" }));
    expect(r.error).toBe("Please enter a valid 10-digit US or Canadian mobile number.");
    expect(h.texts).toHaveLength(0);
  });
  it("E1: promo-box-only requests count toward the per-internet-address limit", async () => {
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const r = await signUpForTexts({}, form({ phone: `84555512${String(i).padStart(2, "0")}`, marketing: "on" }));
      if (r.ok) ok++;
      else expect(r.error).toBe("Too many sign-ups right now. Please try again tomorrow or call us.");
    }
    expect(ok).toBe(20);
    expect(h.texts).toHaveLength(20);
  });
  it("E10: while the button says Not active yet, a direct post records nothing", async () => {
    const env = { ...process.env };
    process.env.VERCEL_ENV = "production";
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    h.ip = "198.51.100.10";
    try {
      const r = await signUpForTexts({}, form({ phone: "8455551299", transactional: "on" }));
      expect(r.error).toBe("Not active yet: waiting for Twilio A2P approval");
      expect(await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455551299"))).toHaveLength(0);
    } finally {
      process.env = env;
    }
  });
});

describe("E4: a failed catalog email does not count as sent today", () => {
  it("only a sent one blocks a second try", async () => {
    await db.insert(schema.auditLog).values({ action: "catalog.website_request", entityType: "email", entityId: "a@example.com", after: { sent: false } });
    expect(await catalogEmailedToday("a@example.com")).toBe(false);
    await db.insert(schema.auditLog).values({ action: "catalog.website_request", entityType: "email", entityId: "a@example.com", after: { sent: true } });
    expect(await catalogEmailedToday("a@example.com")).toBe(true);
  });
});

describe("E6, E7: catalog by text", () => {
  it("E7: two requests at once send the catalog once", async () => {
    await saveSetting("catalogTextItems", JSON.stringify([{ photo: "/api/catalog-photo/catalog/text/a.jpg", text: "" }]));
    const sent: string[] = [];
    const send = async (to: string) => (sent.push(to), await new Promise((r) => setTimeout(r, 20)), { sent: true });
    const [a, b] = await Promise.all([replyToCatalogText("+18455550301", { optedOut: false, send }), replyToCatalogText("+18455550301", { optedOut: false, send })]);
    expect([a.replied, b.replied].sort()).toEqual([false, true]);
    expect([a.reason, b.reason]).toContain("already_today");
    expect(sent).toHaveLength(2); // the first text and one photo, once
    expect(await catalogTextedToday("+18455550301")).toBe(true);
  });
  it("E7: a failed send releases the mark, so a later try today can send", async () => {
    const r1 = await replyToCatalogText("+18455550302", { optedOut: false, send: async () => ({ sent: false }) });
    expect(r1.replied).toBe(false);
    expect(await catalogTextedToday("+18455550302")).toBe(false);
    const r2 = await replyToCatalogText("+18455550302", { optedOut: false, send: async () => ({ sent: true }) });
    expect(r2.replied).toBe(true);
  });
  it("E6: with no catalog photos the Owner is alerted at most once an hour", async () => {
    await saveSetting("catalogTextItems", "[]");
    await saveSetting("catalogTextPicture1", "");
    await saveSetting("catalogTextPicture2", "");
    await saveSetting("catalogTextMissingAt", "");
    const { sendCatalogMessages } = await import("@/lib/catalog-send");
    const first = await sendCatalogMessages("words", async () => ({ sent: true }));
    const second = await sendCatalogMessages("words", async () => ({ sent: true }));
    expect(first).toMatchObject({ sent: false, quiet: false });
    expect(second).toMatchObject({ sent: false, quiet: true });
  });
});

describe("E8: Twilio status notices out of order", () => {
  it("a late 'sent' never moves 'delivered' back; a later status still applies", async () => {
    expect(smsStatusRank("failed")).toBe(smsStatusRank("delivered"));
    await db.insert(schema.messages).values({ direction: "out", toNumber: "+18455550401", contactPhone: "+18455550401", fromNumber: "+18454157585", body: "x", twilioSid: "SMe8", status: "queued" });
    const st = async () => (await db.select().from(schema.messages).where(eq(schema.messages.twilioSid, "SMe8")))[0].status;
    await handleSmsStatus({ MessageSid: "SMe8", MessageStatus: "delivered" });
    expect(await st()).toBe("delivered");
    await handleSmsStatus({ MessageSid: "SMe8", MessageStatus: "sent" });
    expect(await st()).toBe("delivered");
    await handleSmsStatus({ MessageSid: "SMe8", MessageStatus: "failed", ErrorCode: "30003" });
    expect(await st()).toBe("delivered");
    await db.insert(schema.messages).values({ direction: "out", toNumber: "+18455550402", contactPhone: "+18455550402", fromNumber: "+18454157585", body: "x", twilioSid: "SMe8b", status: "queued" });
    await handleSmsStatus({ MessageSid: "SMe8b", MessageStatus: "sent" });
    await handleSmsStatus({ MessageSid: "SMe8b", MessageStatus: "undelivered", ErrorCode: "30005" });
    expect((await db.select().from(schema.messages).where(eq(schema.messages.twilioSid, "SMe8b")))[0].status).toBe("undelivered");
  });
});

describe("E9: inbound email filed once", () => {
  it("two last pieces at once file one email", async () => {
    const raw = Buffer.from("From: Sara <sara@example.com>\r\nTo: info@hupupattractions.com\r\nSubject: Hello\r\n\r\nHi there\r\n");
    const id = "upload-e9-test-1";
    const [a, b] = await Promise.all([receiveRawPiece(id, 0, 1, raw), receiveRawPiece(id, 0, 1, raw)]);
    expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(schema.inboxEmails).where(eq(schema.inboxEmails.uploadId, id))).toHaveLength(1);
  });
});

describe("E11: info@ Catalog emails from one sender at once", () => {
  it("send one reply", async () => {
    const before = process.env.INBOUND_EMAIL_SECRET;
    process.env.INBOUND_EMAIL_SECRET = "test-secret";
    let sent = 0;
    const send = async () => (sent++, await new Promise((r) => setTimeout(r, 20)), { sent: true });
    try {
      const rs = await Promise.all([handleCatalogEmail("x@example.com", "Catalog", new Date(), send), handleCatalogEmail("X@example.com", "Catalog", new Date(), send)]);
      expect(sent).toBe(1);
      expect(rs.map((r) => r.reason).sort()).toEqual(["already_today", null].sort());
      const rows = await db.select().from(schema.catalogEmailRequests).where(and(eq(schema.catalogEmailRequests.sender, "x@example.com")));
      expect(rows.map((r) => r.replied).sort()).toEqual([false, true]);
    } finally {
      if (before === undefined) delete process.env.INBOUND_EMAIL_SECRET;
      else process.env.INBOUND_EMAIL_SECRET = before;
    }
  });
});

describe("E5: info@ Catalog auto-reply only to the real sender", () => {
  it("From line must match the envelope sender when the worker passes it", async () => {
    const { catalogReplyAllowed } = await import("@/lib/inbox");
    expect(catalogReplyAllowed("sara@example.com", null)).toBe(true);
    expect(catalogReplyAllowed("sara@example.com", "Sara@Example.com")).toBe(true);
    expect(catalogReplyAllowed("victim@example.com", "spammer@bad.example")).toBe(false);
  });
  it("the worker passes the envelope sender and the route reads it", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("cloudflare/info-inbox-worker.js", "utf8")).toContain('"x-envelope-from": String(message.from || "")');
    expect(readFileSync("src/app/api/email/inbound-raw/route.ts", "utf8")).toContain('req.headers.get("x-envelope-from")');
  });
});
