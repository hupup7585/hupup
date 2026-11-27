import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Extra check J (Nov 27, 2026): text messages. The number counts, not one customer record; an opt-out is never lost
   on Twilio's retry; a picture text resent as plain text is changed and counted once. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms-inbound";
import { promosThisYear } from "@/lib/sms";

const text = (from: string, body: string, sid: string) => handleInboundSms({ From: from, To: "+18454157585", Body: body, MessageSid: sid });
const rows = (phone: string) => db.select().from(schema.customers).where(eq(schema.customers.phone, phone)).orderBy(schema.customers.id);

describe("extra check J: text messages", () => {
  it("J1: NOPROMO turns promotions off on every record with the number", async () => {
    const phone = "+18455550601";
    await db.insert(schema.customers).values([
      { phone, name: "A", marketingOptIn: true },
      { phone, name: "B", marketingOptIn: true },
    ]);
    await text(phone, "NOPROMO", "SMJ1a");
    expect((await rows(phone)).map((c) => c.marketingOptIn)).toEqual([false, false]);
  });

  it("J1: STOP blocks and turns promotions off on every record; START then YES never brings a duplicate's old promo sign-up back", async () => {
    const phone = "+18455550602";
    await db.insert(schema.customers).values([
      { phone, name: "A", marketingOptIn: true },
      { phone, name: "B", marketingOptIn: true },
    ]);
    await text(phone, "Please stop texting me", "SMJ1b");
    expect((await rows(phone)).map((c) => [c.smsOptOut, c.marketingOptIn])).toEqual([
      [true, false],
      [true, false],
    ]);
    await text(phone, "START", "SMJ1c");
    await text(phone, "YES", "SMJ1d");
    expect((await rows(phone)).map((c) => [c.smsOptOut, c.marketingOptIn])).toEqual([
      [false, false],
      [false, false],
    ]);
  });

  it("J3: a STOP saved on another record still lets START and YES lift the block", async () => {
    const phone = "+18455550603";
    await db.insert(schema.customers).values([
      { phone, name: "A" },
      { phone, name: "B", smsOptOut: true }, // e.g. a carrier 21610 on an order text to record B
    ]);
    await text(phone, "START", "SMJ3a");
    const [pending] = await db.select().from(schema.smsReenrollRequests).where(and(eq(schema.smsReenrollRequests.phone, phone), eq(schema.smsReenrollRequests.status, "pending")));
    expect(pending).toBeTruthy();
    await text(phone, "YES", "SMJ3b");
    expect((await rows(phone)).every((c) => !c.smsOptOut)).toBe(true);
  });

  it("J3: a carrier block (21610) is recorded like a STOP: every record, an opt-out record, waiting texts canceled", () => {
    const src = readFileSync("src/lib/sms.ts", "utf8").split('String(err.code) === "21610"')[1].slice(0, 1200);
    expect(src).toContain("eq(schema.customers.phone, phone)");
    // deep check 06:00 M13: the number the text went to, never the order customer's own phone
    expect(src).toContain("const phone = toE164(m.to) ?? m.to;");
    expect(src).not.toContain("m.customer.phone");
    expect(src).toContain('action: "opt_out"');
    expect(src).toContain("cancelQueuedMessages(phone)");
  });

  it("J2: Twilio's retry of a STOP whose first handling failed after the text was saved finishes the opt-out", async () => {
    const phone = "+18455550604";
    const [c] = await db.insert(schema.customers).values({ phone, name: "C", marketingOptIn: true }).returning();
    // the first try saved the text, then failed before the opt-out was recorded
    await db.insert(schema.messages).values({ direction: "in", fromNumber: phone, contactPhone: phone, body: "STOP", kind: "inbound", event: "keyword_stop", twilioSid: "SMJ2a", status: "received", customerId: c.id });
    await text(phone, "STOP", "SMJ2a");
    const [after] = await rows(phone);
    expect(after.smsOptOut).toBe(true);
    const outs = await db.select().from(schema.smsConsents).where(and(eq(schema.smsConsents.phone, phone), eq(schema.smsConsents.action, "opt_out")));
    expect(outs.length).toBe(2); // order texts and promotions
    expect(await db.select().from(schema.messages).where(eq(schema.messages.twilioSid, "SMJ2a"))).toHaveLength(1);
    // a further retry is a plain duplicate: nothing recorded twice
    await text(phone, "STOP", "SMJ2a");
    expect((await db.select().from(schema.smsConsents).where(and(eq(schema.smsConsents.phone, phone), eq(schema.smsConsents.action, "opt_out")))).length).toBe(2);
  });

  it("J4: a failed picture promotion doesn't count toward the yearly limit; the plain-text resend keeps its words", async () => {
    const phone = "+18455550605";
    await db.insert(schema.messages).values([
      { direction: "out", toNumber: phone, contactPhone: phone, body: "promo", kind: "marketing", status: "failed" },
      { direction: "out", toNumber: phone, contactPhone: phone, body: "promo", kind: "marketing", status: "sent" },
    ]);
    expect(await promosThisYear(phone)).toBe(1);
    const src = readFileSync("src/lib/sms.ts", "utf8");
    expect(src).toContain("retry: () => sendMessage({ ...input, mediaUrls: [], mmsResend: true })");
    expect(src).toContain('if (kind === "marketing" && !input.mmsResend) input = { ...input, body: marketingBody(input.body) };');
  });
});
