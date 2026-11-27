import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Extra check G (Nov 27, 2026): scheduled jobs. In-memory database with the real migrations. */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string }[], emailOk: true }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendEmail: async (to: string, subject: string) => (h.emails.push({ to, subject }), { sent: h.emailOk }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { cronAuthorized } from "@/lib/cron-auth";
import { runJob } from "@/lib/jobs";

beforeEach(() => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  h.emails = [];
  h.emailOk = true;
});

describe("G9: cron secret", () => {
  it("only the exact Bearer secret passes; no secret set refuses everything", () => {
    expect(cronAuthorized("Bearer abc123", "abc123")).toBe(true);
    expect(cronAuthorized("Bearer abc124", "abc123")).toBe(false);
    expect(cronAuthorized("Bearer abc1234", "abc123")).toBe(false);
    expect(cronAuthorized(null, "abc123")).toBe(false);
    expect(cronAuthorized("Bearer ", undefined)).toBe(false);
    for (const f of ["frequent", "release-holds", "send-held-promotions"]) expect(readFileSync(`src/app/api/cron/${f}/route.ts`, "utf8")).toContain("cronAuthorized(");
  });
});

describe("G5: a job that keeps failing", () => {
  it("emails the Owner once a day, not on every run", async () => {
    for (let i = 0; i < 3; i++) await runJob("always broken", async () => { throw new Error("down"); }, { waitMs: 1 });
    expect(h.emails.filter((e) => e.subject.includes("always broken"))).toHaveLength(1);
    expect(readFileSync("src/app/api/cron/frequent/route.ts", "utf8")).toMatch(/armWake\("held-texts", inAnHour\(\)\)/);
  });
});

describe("G3: the daily failed-sends report", () => {
  it("counts undelivered texts and held texts that failed today", async () => {
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await db.insert(schema.messages).values([
      { direction: "out", toNumber: "+18455550501", contactPhone: "+18455550501", body: "a", status: "undelivered", errorCode: "30007" },
      { direction: "out", toNumber: "+18455550502", contactPhone: "+18455550502", body: "b", status: "failed", createdAt: old, sendAfter: new Date() },
      { direction: "out", toNumber: "+18455550503", contactPhone: "+18455550503", body: "c", status: "failed", createdAt: old },
    ]);
    const { failedSendsReport } = await import("@/lib/ops-alerts");
    const r = await failedSendsReport();
    expect(r.texts).toBe(2);
  });
});

describe("G2: scheduled emails on Shabbes", () => {
  it("a scheduled email due on Shabbes waits; it goes out after", async () => {
    const [d] = await db.insert(schema.inboxDrafts).values({ toAddress: "c@example.com", subject: "Hi", body: "Hello", sendAt: new Date("2026-11-28T15:00:00Z") }).returning();
    const { sendScheduledEmails } = await import("@/lib/inbox");
    const shabbes = new Date("2026-11-28T16:00:00Z"); // Saturday 11 AM in New York
    const r = await sendScheduledEmails(shabbes);
    expect(r).toMatchObject({ due: 0, sent: 0 });
    const [still] = await db.select().from(schema.inboxDrafts).where(eq(schema.inboxDrafts.id, d.id));
    expect(still.sendAt).not.toBeNull();
    expect(still.sentReplyId).toBeNull();
  });
});

describe("G4: held texts", () => {
  it("a claim left 'sending' by a cut-off run is held again after 15 minutes; a fresh claim is left alone", async () => {
    const { processHeldPromotions, STUCK_SENDING_MS, HELD_TEXTS_PER_RUN } = await import("@/lib/sms");
    expect(HELD_TEXTS_PER_RUN).toBe(200);
    const now = new Date();
    const [stuck, fresh] = await db
      .insert(schema.messages)
      .values([
        { direction: "out", toNumber: "+18455550601", contactPhone: "+18455550601", body: "x", kind: "system", event: "owner_alert", status: "sending", sendAfter: new Date(now.getTime() - STUCK_SENDING_MS - 60_000) },
        { direction: "out", toNumber: "+18455550602", contactPhone: "+18455550602", body: "y", kind: "system", event: "owner_alert", status: "sending", sendAfter: new Date(now.getTime() - 60_000) },
      ])
      .returning();
    await processHeldPromotions(now).catch(() => null);
    const st = async (id: number) => (await db.select().from(schema.messages).where(eq(schema.messages.id, id)))[0].status;
    expect(await st(stuck.id)).not.toBe("sending");
    expect(await st(fresh.id)).toBe("sending");
  });
});

describe("G6, G7, G8, G10: code checks", () => {
  it("held address texts only for open problems; JOIN invites in daytime runs; Admin calendar for text holds; timer never later", () => {
    expect(readFileSync("src/lib/address-checks.ts", "utf8")).toContain('const held = await db.select().from(schema.addressChecks).where(inArray(schema.addressChecks.status, ["unconfirmed", "problem"]))');
    expect(readFileSync("src/app/api/cron/frequent/route.ts", "utf8")).toContain('"JOIN invitations (every 3 hours)"');
    const sms = readFileSync("src/lib/sms.ts", "utf8");
    expect(sms).toContain("smsBookingLock(now)");
    expect(sms).not.toMatch(/[^s]bookingLock\(now\)\.locked/);
    expect(sms).toContain('armWake("held-texts", again, { earliest: true })');
  });
});

describe("G1: a voicemail alert that did not go out", () => {
  it("is released so the safety net tries again", async () => {
    const { notifyVoicemail } = await import("@/lib/voicemail");
    const [box] = await db.insert(schema.voicemailBoxes).values({ name: "Main", isMain: true, notifyEmail: ["owner@example.com"] }).returning();
    const [v] = await db.insert(schema.voicemails).values({ boxId: box.id, fromNumber: "+18455550701", recordingSid: "RE1", recordingUrl: "https://api.twilio.com/x", state: "submitted" } as never).returning();
    h.emailOk = false;
    await notifyVoicemail(v.id);
    expect((await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, v.id)))[0].notifiedAt).toBeNull();
    h.emailOk = true;
    const r = await notifyVoicemail(v.id);
    expect(r.sent).toBe(1);
    expect((await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, v.id)))[0].notifiedAt).not.toBeNull();
  });
});

describe("deep check 06:00 M71: an error after the voicemail alert was claimed", () => {
  it("releases the claim when nothing went out, so the safety net tries again", () => {
    const src = readFileSync("src/lib/voicemail.ts", "utf8");
    const notify = src.split("export async function notifyVoicemail")[1].split("async function sendVoicemailAlert")[0];
    expect(notify).toContain("return await sendVoicemailAlert(v, counts);");
    expect(notify).toContain("if (!counts.sent && !counts.held) await db.update(schema.voicemails).set({ notifiedAt: null })");
    expect(notify).toContain("throw e;");
  });
});
