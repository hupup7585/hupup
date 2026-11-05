import "dotenv/config";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import twilio from "twilio";
import { eq, inArray } from "drizzle-orm";

const hasDb = Boolean(process.env.DATABASE_URL);
const TOKEN = "test_auth_token_123";

describe.skipIf(!hasDb)("SMS: inbound, keywords, status, sending", async () => {
  const { db, schema, closeDb } = await import("@/lib/db");
  const { setTwilioForTests } = await import("@/lib/twilio-client");
  const { sendMessage, containsCardNumber } = await import("@/lib/sms");
  const { detectKeyword } = await import("@/lib/sms-inbound");
  const incoming = await import("@/app/api/sms/incoming/route");
  const status = await import("@/app/api/sms/status/route");

  const phone = `+1845555${String(Date.now()).slice(-4)}`;
  const sent: Record<string, unknown>[] = [];
  let failNextWithMedia = false;
  const fake = {
    messages: {
      create: async (p: Record<string, unknown>) => {
        if (failNextWithMedia && Array.isArray(p.mediaUrl) && p.mediaUrl.length) {
          failNextWithMedia = false;
          throw Object.assign(new Error("Media fetch failed"), { code: 11200 });
        }
        sent.push(p);
        return { sid: `SM${Date.now()}${Math.random().toString(16).slice(2, 8)}`, status: "queued" };
      },
    },
  };

  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = TOKEN;
    process.env.TWILIO_PHONE_NUMBER = "+18454157585";
    process.env.PUBLIC_BASE_URL = "https://hupupattractions.com";
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, "smsForwardPhone"));
    setTwilioForTests(fake);
  });
  beforeEach(() => {
    sent.length = 0;
  });
  afterAll(async () => {
    setTwilioForTests(undefined);
    const custs = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone));
    const ids = custs.map((c) => c.id);
    await db.delete(schema.messages).where(eq(schema.messages.contactPhone, phone));
    if (ids.length) {
      // Once migration 0004 is applied, sms_consents is append-only (and customers with consents can't be
      // deleted), so test rows stay behind on the local test DB; before it, clean up as usual.
      try {
        await db.delete(schema.smsConsents).where(inArray(schema.smsConsents.customerId, ids));
        await db.delete(schema.customers).where(inArray(schema.customers.id, ids));
      } catch {
        /* permanent consent record */
      }
    }
    await closeDb();
  });

  /** Build a request exactly as Twilio would sign it, for a given public host. */
  function signed(path: string, params: Record<string, string>, host: string, sign = true) {
    const url = `https://${host}${path}`;
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", host, "x-forwarded-proto": "https" };
    if (sign) headers["x-twilio-signature"] = twilio.getExpectedTwilioSignature(TOKEN, url, params);
    return new Request(`http://localhost:3000${path}`, { method: "POST", headers, body: new URLSearchParams(params) });
  }

  it("rejects unsigned or wrongly signed webhooks", async () => {
    const res = await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "hi" }, "hupup.vercel.app", false));
    expect(res.status).toBe(403);
    const bad = signed("/api/sms/incoming", { From: phone, Body: "hi" }, "hupup.vercel.app");
    bad.headers.set("x-twilio-signature", "nope");
    expect((await incoming.POST(bad)).status).toBe(403);
    expect((await status.POST(signed("/api/sms/status", { MessageSid: "x" }, "evil.example", false))).status).toBe(403);
  });

  it("accepts signatures for hupup.vercel.app and for PUBLIC_BASE_URL", async () => {
    const a = await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "Hello there", MessageSid: `SMa${Date.now()}` }, "hupup.vercel.app"));
    expect(a.status).toBe(200);
    expect(await a.text()).toContain("<Response");
    const b = await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "Second", MessageSid: `SMb${Date.now()}` }, "hupupattractions.com"));
    expect(b.status).toBe(200);
  });

  it("stores inbound text with media, creates the customer, and forwards a copy to the owner", async () => {
    process.env.ADMIN_PHONE = "+18457777585";
    const sid = `SMm${Date.now()}`;
    await incoming.POST(
      signed("/api/sms/incoming", { From: phone, Body: "Can I add a slide?", NumMedia: "1", MediaUrl0: "https://api.twilio.com/m/1", MessageSid: sid }, "hupup.vercel.app"),
    );
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.twilioSid, sid));
    expect(m.direction).toBe("in");
    expect(m.mediaUrls).toEqual(["https://api.twilio.com/m/1"]);
    expect(m.customerId).toBeTruthy();
    expect(sent.some((p) => p.to === "+18457777585" && String(p.body).includes("Can I add a slide?"))).toBe(true);
    // duplicate delivery is ignored
    await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "Can I add a slide?", MessageSid: sid }, "hupup.vercel.app"));
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.twilioSid, sid));
    expect(rows).toHaveLength(1);
  });

  it("keywords: STOP opts out of everything, START + YES restores order texts, NOPROMO stops marketing only", async () => {
    expect(detectKeyword(" stop ")).toBe("stop");
    expect(detectKeyword("Unsubscribe")).toBe("stop");
    expect(detectKeyword("start")).toBe("start");
    expect(detectKeyword("help")).toBe("help");
    expect(detectKeyword("stop by at 5?")).toBeNull();

    const [c0] = await db.select().from(schema.customers).where(eq(schema.customers.phone, phone));
    await db.update(schema.customers).set({ marketingOptIn: true }).where(eq(schema.customers.id, c0.id));

    await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "STOP", MessageSid: `SMs${Date.now()}` }, "hupup.vercel.app"));
    let [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, c0.id));
    expect(c.smsOptOut).toBe(true);
    expect(c.marketingOptIn).toBe(false);
    const blocked = await sendMessage({ to: phone, body: "Your booking is confirmed", event: "booking_confirmation" });
    expect(blocked.blocked).toBe("opted_out");

    await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "START", MessageSid: `SMt${Date.now()}` }, "hupup.vercel.app"));
    [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, c0.id));
    expect(c.smsOptOut).toBe(true); // START alone enrolls no one; it asks for YES
    await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "YES", MessageSid: `SMy${Date.now()}` }, "hupup.vercel.app"));
    [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, c0.id));
    expect(c.smsOptOut).toBe(false);
    expect(c.marketingOptIn).toBe(false); // needs a fresh opt-in

    await db.update(schema.customers).set({ marketingOptIn: true }).where(eq(schema.customers.id, c0.id));
    const res = await incoming.POST(signed("/api/sms/incoming", { From: phone, Body: "NOPROMO", MessageSid: `SMn${Date.now()}` }, "hupup.vercel.app"));
    expect(await res.text()).toContain("won't receive promotional texts");
    [c] = await db.select().from(schema.customers).where(eq(schema.customers.id, c0.id));
    expect(c.marketingOptIn).toBe(false);
    expect(c.smsOptOut).toBe(false);
    const consents = await db.select({ scope: schema.smsConsents.scope, action: schema.smsConsents.action }).from(schema.smsConsents).where(eq(schema.smsConsents.customerId, c0.id));
    expect(consents.map((x) => `${x.scope}:${x.action}`)).toEqual(
      expect.arrayContaining(["transactional:opt_out", "marketing:opt_out", "transactional:opt_in"]),
    );
  });

  it("marketing texts require consent", async () => {
    const r = await sendMessage({ to: phone, body: "Hup Up Attractions: Summer special! Reply STOP to opt out", kind: "marketing" });
    expect(r.blocked).toBe("no_marketing_consent");
  });

  it("logs outbound texts and updates delivery status from Twilio callbacks, including failures", async () => {
    const r = await sendMessage({ to: phone, body: "Order 1001 confirmed", event: "booking_confirmation", userId: 7 });
    expect(r.sent).toBe(true);
    expect(sent[0].statusCallback).toBe("https://hupupattractions.com/api/sms/status");
    await status.POST(signed("/api/sms/status", { MessageSid: r.sid!, MessageStatus: "undelivered", ErrorCode: "30003" }, "hupup.vercel.app"));
    const [m] = await db.select().from(schema.messages).where(eq(schema.messages.id, r.messageId!));
    expect(m.status).toBe("undelivered");
    expect(m.errorCode).toBe("30003");
    expect(m.userId).toBe(7);
    expect(m.event).toBe("booking_confirmation");
  });

  it("falls back to plain SMS when MMS fails, keeping a record of the failure", async () => {
    failNextWithMedia = true;
    const r = await sendMessage({ to: phone, body: "Delivered!", mediaUrls: ["https://example.com/p.jpg"], event: "delivery_completed" });
    expect(r.sent).toBe(true);
    expect(r.mmsFallback).toBe(true);
    const rows = await db.select().from(schema.messages).where(eq(schema.messages.contactPhone, phone));
    expect(rows.some((x) => x.status === "failed" && x.errorCode === "11200")).toBe(true);
    expect(sent.at(-1)!.mediaUrl).toBeUndefined();
  });

  it("never sends card numbers", async () => {
    expect(containsCardNumber("card 4111 1111 1111 1111 exp 12/29")).toBe(true);
    expect(containsCardNumber("Order 1001, call (845) 415-7585")).toBe(false);
    const r = await sendMessage({ to: phone, body: "Your card 4111111111111111" });
    expect(r.blocked).toBe("card_number");
    expect(sent).toHaveLength(0);
  });
});
