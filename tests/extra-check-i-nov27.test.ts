import { beforeEach, describe, expect, it, vi } from "vitest";

/* Extra check I (Nov 27, 2026, phone helpers outside flow.ts). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
const emails: string[] = [];
vi.mock("@/lib/notify", () => ({ sendEmail: async (_to: string, subject: string) => (emails.push(subject), { sent: true }), sendSms: async () => ({ sent: true }) }));

const removed: string[] = [];
const r2Deleted: string[] = [];
vi.mock("@/lib/twilio-client", () => ({ getTwilio: () => ({ recordings: (sid: string) => ({ remove: async () => void removed.push(sid) }) }) }));
vi.mock("@/lib/r2", () => ({ r2Ready: () => true, r2Delete: async (k: string) => void r2Deleted.push(k), r2Get: async () => null, r2Put: async () => null }));

const saved: Record<string, unknown> = {};
vi.mock("@/lib/auth", () => ({ requireOwner: async () => ({ userId: 1 }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/settings", async (orig) => ({ ...(await orig<typeof import("@/lib/settings")>()), getSettings: async () => ({}), saveSetting: async (k: string, v: unknown) => void (saved[k] = v) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { checkBoxPin } from "@/lib/vm-boxes";
import { purgeVoicemail } from "@/lib/voicemail";

const box = async () => {
  const [b] = await db.insert(schema.voicemailBoxes).values({ name: "Owner", boxNumber: String(100 + Math.floor(Math.random() * 1e6)) }).returning();
  return b;
};
const row = async (id: number) => (await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.id, id)))[0];

describe("I1: the voicemail box password lockout holds with several calls at once", () => {
  beforeEach(() => {
    emails.length = 0;
    process.env.ADMIN_EMAIL = "owner@example.com";
  });
  it("five wrong guesses at the same moment (each call holding the same old copy of the box) lock the box", async () => {
    const b = await box();
    const results = await Promise.all(["1111", "2222", "3333", "4444", "5555"].map((p) => checkBoxPin(b, p)));
    expect(results.filter((r) => r === "wrong")).toHaveLength(2);
    expect(results.filter((r) => r === "locked")).toHaveLength(3);
    expect((await row(b.id)).lockedUntil).not.toBeNull();
    // the right password is refused while locked, even from a call that read the box before the lock
    expect(await checkBoxPin(b, "1234")).toBe("locked");
  });
  it("deep check 06:00 M20: a burst of 10 guesses with the right password last never opens the box", async () => {
    const b = await box();
    const results = await Promise.all(["1", "2", "3", "4", "5", "6", "7", "8", "9", "1234"].map((p) => checkBoxPin(b, p)));
    expect(results).not.toContain("ok");
    expect(results.at(-1)).toBe("locked");
  });
  it("the Owner gets one lock email, not one per call", async () => {
    const b = await box();
    await Promise.all(["1", "2", "3", "4", "5", "6"].map((p) => checkBoxPin(b, p)));
    expect(emails.filter((s) => s.includes("locked"))).toHaveLength(1);
  });
  it("single calls work as before: 2 wrong, then right resets; 3 wrong locks; after 15 minutes the count starts again", async () => {
    const b = await box();
    expect(await checkBoxPin(b, "0000")).toBe("wrong");
    expect(await checkBoxPin(b, "0000")).toBe("wrong");
    expect(await checkBoxPin(b, "1234")).toBe("ok");
    expect((await row(b.id)).wrongTries).toBe(0);
    for (let i = 0; i < 2; i++) expect(await checkBoxPin(b, "0000")).toBe("wrong");
    expect(await checkBoxPin(b, "0000")).toBe("locked");
    const later = new Date(Date.now() + 16 * 60_000);
    expect(await checkBoxPin(b, "0000", later)).toBe("wrong");
    expect((await row(b.id)).wrongTries).toBe(1);
    expect(await checkBoxPin(b, "1234", later)).toBe("ok");
  });
});

describe("I2: Admin 'Delete for good' with forwarded copies", () => {
  const msg = async (v: Partial<typeof schema.voicemails.$inferInsert>) => {
    const [b] = await db.insert(schema.voicemailBoxes).values({ name: "Box" }).returning();
    const [r] = await db
      .insert(schema.voicemails)
      .values({ boxId: b.id, recordingSid: `RE${Math.random()}`, recordingUrl: "https://api.twilio.com/x/Recordings/RE1", durationSec: 10, state: "submitted", ...v })
      .returning();
    return r;
  };
  const vmRow = async (id: number) => (await db.select().from(schema.voicemails).where(eq(schema.voicemails.id, id)))[0];
  beforeEach(() => {
    removed.length = 0;
    r2Deleted.length = 0;
  });
  it("a forwarded copy can be deleted for good, and the original keeps its recording", async () => {
    const orig = await msg({ pieces: 2 });
    const copy = await msg({ recordingSid: `fwd-${orig.id}-9-1`, audioOf: orig.id });
    expect(await purgeVoicemail(copy.id)).toBe(true);
    expect((await vmRow(copy.id)).purgedAt).not.toBeNull();
    expect(removed).toEqual([]);
    expect(r2Deleted).toEqual([]);
    expect((await vmRow(orig.id)).purgedAt).toBeNull();
  });
  it("the original with a copy still kept: hidden for good, but the recording stays for the copy", async () => {
    const orig = await msg({ pieces: 2 });
    await msg({ recordingSid: `fwd-${orig.id}-8-1`, audioOf: orig.id });
    expect(await purgeVoicemail(orig.id)).toBe(true);
    expect(removed).toEqual([]);
    expect((await vmRow(orig.id)).pieces).toBe(2);
  });
  it("the last one kept takes the Twilio recording and the pieces with it", async () => {
    const orig = await msg({ pieces: 2 });
    const copy = await msg({ recordingSid: `fwd-${orig.id}-7-1`, audioOf: orig.id, noteKey: "voicemail/note/n1.wav" });
    await purgeVoicemail(orig.id);
    expect(await purgeVoicemail(copy.id)).toBe(true);
    expect(removed).toEqual([orig.recordingSid]);
    expect(r2Deleted.sort()).toEqual([`voicemail/${orig.id}/0.wav`, `voicemail/${orig.id}/1.wav`, "voicemail/note/n1.wav"].sort());
    expect((await vmRow(orig.id)).pieces).toBeNull();
  });
  it("a message with no copies works as before", async () => {
    const one = await msg({});
    expect(await purgeVoicemail(one.id)).toBe(true);
    expect(removed).toEqual([one.recordingSid]);
    expect(await purgeVoicemail(one.id)).toBe(false); // already deleted for good
  });
});

describe("I3: a repeated recording callback keeps the staff message's number", () => {
  it("the second vm-rec-done for the same recording goes to the review with the same message id", async () => {
    const { makeVmHandlers } = await import("@/lib/ivr/vmail");
    const twilio = (await import("twilio")).default;
    const went: Record<string, unknown>[] = [];
    const h = {
      sp: () => undefined,
      say: () => undefined,
      back: (vr: never, _a: string, p: Record<string, unknown> = {}) => (went.push(p), vr),
      url: () => "https://example.test/",
      backLine: () => undefined,
      when: () => ({ date: "", time: "" }),
      update: async () => undefined,
      timer: () => 5,
    };
    const handlers = makeVmHandlers(h as never);
    const [to] = await db.insert(schema.voicemailBoxes).values({ name: "Secretary" }).returning();
    const ctx = {
      callSid: "CA-i3",
      from: null,
      query: new URLSearchParams({ to: String(to.id), k: "send" }),
      body: { RecordingUrl: "https://api.twilio.com/x/Recordings/REi3", RecordingSid: "RE-i3", RecordingDuration: "4" },
      session: { data: { vmMine: to.id } },
      prompts: {},
    };
    await handlers["vm-rec-done"](ctx as never, new twilio.twiml.VoiceResponse());
    await handlers["vm-rec-done"](ctx as never, new twilio.twiml.VoiceResponse());
    expect(went).toHaveLength(2);
    expect(went[0].id).toBeTruthy();
    expect(went[1].id).toBe(went[0].id);
  });
});

describe("I4: Phone settings refuse an after-hours window that never rings", () => {
  const form = (from: string, to: string, key = "6") => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ ringKey: key, targets: "", afterHours: "on", afterFrom: from, afterTo: to, erevTo: "", erevToSummer: "", erevBefore: "0" })) f.set(k, v);
    return f;
  };
  beforeEach(() => {
    for (const k of Object.keys(saved)) delete saved[k];
  });
  it("Until earlier than From (6:00 PM until 1:00 AM) is not saved, with the reason", async () => {
    const { saveRoutingAction } = await import("@/app/admin/(app)/settings/routing-actions");
    const r = await saveRoutingAction(null, form("18:00", "01:00"));
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Until time must be later than From/);
    expect(saved).toEqual({});
  });
  it("the same time for both is not saved either", async () => {
    const { saveRoutingAction } = await import("@/app/admin/(app)/settings/routing-actions");
    expect((await saveRoutingAction(null, form("08:00", "08:00"))).ok).toBe(false);
  });
  it("a normal window (8:00 AM until 10:30 PM) and an empty window save as before, key 8 included", async () => {
    const { saveRoutingAction } = await import("@/app/admin/(app)/settings/routing-actions");
    expect((await saveRoutingAction(null, form("08:00", "22:30"))).ok).toBe(true);
    expect(saved.ringAfterFrom6).toBe("08:00");
    expect(saved.ringAfterTo6).toBe("22:30");
    expect((await saveRoutingAction(null, form("", "", "8"))).ok).toBe(true);
    expect(saved.ringAfterFrom8).toBe("");
  });
  it("an impossible time (25:99) is treated as empty, never stored", async () => {
    const { saveRoutingAction } = await import("@/app/admin/(app)/settings/routing-actions");
    expect((await saveRoutingAction(null, form("25:99", "22:00"))).ok).toBe(true);
    expect(saved.ringAfterFrom6).toBe("");
  });
});
