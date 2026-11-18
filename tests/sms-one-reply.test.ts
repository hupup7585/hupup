import { beforeAll, describe, expect, it, vi } from "vitest";

/*
 * One reply per text (Abraham, Nov 16, 2026): a customer never gets two texts back for one word. Twilio Advanced
 * Opt-Out answers the stop, start and help words itself, so the app sends nothing for them (but still records consent,
 * cancels waiting texts, saves the text, and emails Abraham a copy of HELP). Every other word gets exactly one reply,
 * from the app. Real inbound handler and sending code; Twilio is a recorder, nothing is sent.
 */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string }[], emails: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => {
  const messages = Object.assign(() => ({ update: async () => ({}) }), {
    create: async (p: { to: string; body: string }) => (h.sent.push(p), { sid: `SM${h.sent.length}`, status: "queued" }),
  });
  return { getTwilio: () => ({ messages }) };
});
vi.mock("@/lib/owner-alerts", async (orig) => ({
  ...(await orig<typeof import("@/lib/owner-alerts")>()),
  emailIncomingText: async (m: { body: string }) => void h.emails.push(m.body),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms-inbound";

let sid = 0;
let n = 100;
const fresh = () => `+184555520${String(++n).padStart(2, "0")}`;
const text = (from: string, Body: string) => handleInboundSms({ From: from, To: "+18454157585", Body, MessageSid: `SMone${++sid}` });
/** Replies the app sends for one inbound text: the instant reply plus any text it sends. */
async function repliesTo(from: string, body: string) {
  const before = h.sent.filter((m) => m.to === from).length;
  const r = await text(from, body);
  return (r.reply ? 1 : 0) + h.sent.filter((m) => m.to === from).length - before;
}
const withOrderTexts = async (phone: string) => {
  const [c] = await db.insert(schema.customers).values({ phone }).returning();
  await db.insert(schema.smsConsents).values({ customerId: c.id, phone, scope: "transactional", action: "opt_in", source: "web", method: "checkbox", wording: "order texts" });
  return c;
};

beforeAll(() => {
  process.env.SMS_TERMS_V2 = "1";
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
  process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
});

describe("Twilio answers these words; the app sends nothing (and still does its other work)", () => {
  for (const w of ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT"])
    it(`${w}: no app reply; the opt-out is recorded`, async () => {
      const p = fresh();
      await withOrderTexts(p);
      expect(await repliesTo(p, w)).toBe(0);
      const [c] = await db.select().from(schema.customers).where(eq(schema.customers.phone, p));
      expect(c.smsOptOut).toBe(true);
      expect((await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, p))).some((x) => x.action === "opt_out")).toBe(true);
    });
  for (const w of ["START", "UNSTOP"])
    it(`${w}: no app reply (Twilio sends the approved "reply YES" text once)`, async () => {
      const p = fresh();
      await withOrderTexts(p);
      await text(p, "STOP");
      expect(await repliesTo(p, w)).toBe(0);
    });
  for (const w of ["HELP", "INFO"])
    it(`${w}: no app reply; Abraham gets an email copy`, async () => {
      const p = fresh();
      await withOrderTexts(p);
      const emails = h.emails.length;
      expect(await repliesTo(p, w)).toBe(0);
      expect(h.emails.length).toBe(emails + 1);
    });
});

describe("only the app answers these; exactly one reply", () => {
  it("YES after START: one confirmation (Twilio is quiet on YES)", async () => {
    const p = fresh();
    await withOrderTexts(p);
    await text(p, "STOP");
    await text(p, "START");
    expect(await repliesTo(p, "YES")).toBe(1);
  });
  it("Stop texting me (a clear request to stop all texts): one opt-out confirmation", async () => {
    const p = fresh();
    await withOrderTexts(p);
    expect(await repliesTo(p, "Stop texting me")).toBe(1);
  });
  it("Please stop (another stop sentence): one NOPROMO confirmation", async () => {
    const p = fresh();
    await withOrderTexts(p);
    expect(await repliesTo(p, "Please stop")).toBe(1);
  });
  it("WRONG NUMBER: one opt-out confirmation", async () => {
    const p = fresh();
    await withOrderTexts(p);
    expect(await repliesTo(p, "Wrong number")).toBe(1);
  });
  it("NOPROMO: one confirmation", async () => {
    const p = fresh();
    await withOrderTexts(p);
    expect(await repliesTo(p, "NOPROMO")).toBe(1);
  });
  it("JOIN: one promo confirmation request", async () => {
    const p = fresh();
    await withOrderTexts(p);
    expect(await repliesTo(p, "JOIN")).toBe(1);
  });
  it("CATALOG: only the catalog (Abraham, Nov 18, 2026: the first text, then each catalog photo as its own message)", async () => {
    const { saveSetting } = await import("@/lib/settings");
    await saveSetting("catalogTextItems", JSON.stringify([{ photo: "/api/catalog-photo/catalog/text/a.jpg", text: "" }]));
    const p = fresh();
    await withOrderTexts(p);
    expect(await repliesTo(p, "CATALOG")).toBe(2);
  });
});
