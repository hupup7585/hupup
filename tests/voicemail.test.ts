import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Hotline voicemail end to end through handleVoice, on a throwaway in-memory Postgres (PGlite) with every
 * migration applied. Texts and emails are captured, nothing is sent.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAvm1", fromNumber: "+18455550199", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  sms: [] as { to: string; body: string; opts?: Record<string, unknown> }[],
  emails: [] as { to: string; subject: string }[],
  open: false,
}));

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown>) => Object.assign(h.session, patch),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => h.open }));
vi.mock("@/lib/notify", () => ({
  sendSms: async (to: string, body: string, opts?: Record<string, unknown>) => (h.sms.push({ to, body, opts }), { sent: true }),
  sendEmail: async (to: string, subject: string) => (h.emails.push({ to, subject }), { sent: true }),
}));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { fetchRecordingAudio, mainBox, notifyStragglers, voicemailAlertText } from "@/lib/voicemail";
import { eq } from "drizzle-orm";

const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAvm1", From: "+18455550199", ...body }, callSid: "CAvm1", from: "+18455550199" });

beforeAll(() => {
  process.env.ADMIN_PHONE = "+18457777585";
  process.env.ADMIN_EMAIL = "owner@example.com";
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
});
beforeEach(() => {
  h.sms.length = 0;
  h.emails.length = 0;
  h.open = false;
});

describe("hotline voicemail", () => {
  it("office closed: the menu offers a message on 0, and 0 goes straight to voicemail", async () => {
    expect(await call("menu")).toContain("To leave us a message, press 0.");
    const closed = await call("operator");
    expect(closed).toContain("Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!");
    expect(closed).toContain("/api/voice/voicemail?after=1");
  });

  it("records into the Main box with a beep, transcription and callbacks; Main box alerts the owner by default", async () => {
    const first = await mainBox();
    expect(first.transcribe).toBe(false); // off by default (extra Twilio charge); the owner turns it on
    await db.update(schema.voicemailBoxes).set({ transcribe: true }).where(eq(schema.voicemailBoxes.id, first.id));
    const xml = await call("voicemail");
    const box = await mainBox();
    expect(box.notifySms).toEqual(["+18457777585"]);
    expect(box.notifyEmail).toEqual(["owner@example.com"]);
    expect(xml).toContain("Please leave your name, phone number, and a short message after the beep.");
    expect(xml).toMatch(/<Record [^>]*playBeep="true"/);
    expect(xml).toMatch(/transcribe="true"/);
    expect(xml).toContain(`vm-recording?b=${box.id}&amp;t=1`);
    expect(xml).toContain(`vm-transcription?b=${box.id}`);
    expect(xml).toContain(`voicemail-done?b=${box.id}`);
    expect(h.session.outcome).toBe("voicemail");
  });

  it("saves the recording once (Twilio retries), then alerts by text and email when the transcription arrives, once", async () => {
    const box = await mainBox();
    const rec = { RecordingStatus: "completed", RecordingSid: "RE111", RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE111", RecordingDuration: "42" };
    await call("vm-recording", rec, `b=${box.id}&t=1`);
    await call("vm-recording", rec, `b=${box.id}&t=1`);
    const rows = await db.select().from(schema.voicemails).where(eq(schema.voicemails.recordingSid, "RE111"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromNumber: "+18455550199", durationSec: 42, transcriptionStatus: "pending" });
    expect(h.sms).toHaveLength(0); // waits for the transcription

    await call("vm-transcription", { RecordingSid: "RE111", TranscriptionStatus: "completed", TranscriptionText: "Hi, I need a bounce house for Sunday." });
    await call("vm-transcription", { RecordingSid: "RE111", TranscriptionStatus: "completed", TranscriptionText: "Hi, I need a bounce house for Sunday." });
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].to).toBe("+18457777585");
    expect(h.sms[0].body).toBe('Hup Up Attractions: new voicemail from (845) 555-0199, 0:42. "Hi, I need a bounce house for Sunday." Listen: https://hupup.example/admin/voicemail');
    expect(h.sms[0].opts).toMatchObject({ kind: "system" });
    expect(h.emails).toEqual([{ to: "owner@example.com", subject: "New voicemail from (845) 555-0199" }]);
  });

  it("with transcription off, alerts right away; empty recordings are ignored", async () => {
    const box = await mainBox();
    await call("vm-recording", { RecordingStatus: "completed", RecordingSid: "RE000", RecordingUrl: "https://api.twilio.com/x/RE000", RecordingDuration: "0" }, `b=${box.id}&t=0`);
    expect((await db.select().from(schema.voicemails).where(eq(schema.voicemails.recordingSid, "RE000"))).length).toBe(0);
    await call("vm-recording", { RecordingStatus: "completed", RecordingSid: "RE222", RecordingUrl: "https://api.twilio.com/x/RE222", RecordingDuration: "7" }, `b=${box.id}&t=0`);
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].body).toContain("0:07. Listen:");
  });

  it("uses the box's own greeting when the owner sets one, and says nothing was left if the caller hangs up silent", async () => {
    const box = await mainBox();
    await db.update(schema.voicemailBoxes).set({ greetingText: "You reached Hup Up Attractions after hours. Leave a message!" }).where(eq(schema.voicemailBoxes.id, box.id));
    const xml = await call("voicemail");
    expect(xml).toContain("You reached Hup Up Attractions after hours. Leave a message!");
    expect(xml).not.toContain("Please leave your name, phone number");
    expect(await call("voicemail-done", { RecordingDuration: "0" })).toContain("We didn't get a message.");
    expect(await call("voicemail-done", { RecordingDuration: "12" })).toContain("Thanks! We got your message");
    await db.update(schema.voicemailBoxes).set({ greetingText: null }).where(eq(schema.voicemailBoxes.id, box.id));
  });

  it("office open: 0 rings the office; if no one answers, Abraham's missed-call line then the voicemail beep", async () => {
    h.open = true;
    process.env.FORWARD_PHONE = "+18457777585";
    const dial = await call("operator");
    expect(dial).toMatch(/<Dial [^>]*action="[^"]*operator-done\?i=0"/);
    const missed = await call("operator-done", { DialCallStatus: "no-answer" });
    expect(missed).toContain("Sorry, we missed your call, our team is busy helping others right now. Please leave a message after the tone and someone will get back to you shortly. Thank you and have a wonderful day!");
    expect(missed).toContain("/api/voice/voicemail?after=1");
    // After the missed-call line: no second greeting, straight to the beep
    const vm = await call("voicemail", {}, "after=1");
    expect(vm).not.toContain("Please leave your name");
    expect(vm).toMatch(/<Record [^>]*playBeep="true"/);
    expect(await call("operator-done", { DialCallStatus: "completed" })).toContain("<Hangup/>");
    delete process.env.FORWARD_PHONE;
  });

  it("voicemail switched off: the caller goes back to the menu", async () => {
    const box = await mainBox();
    await db.update(schema.voicemailBoxes).set({ enabled: false }).where(eq(schema.voicemailBoxes.id, box.id));
    const xml = await call("voicemail");
    expect(xml).not.toContain("<Record");
    expect(xml).toContain("/api/voice/menu");
    await db.update(schema.voicemailBoxes).set({ enabled: true }).where(eq(schema.voicemailBoxes.id, box.id));
  });

  it("the daily safety net alerts for a message whose transcription never came", async () => {
    const box = await mainBox();
    await db.insert(schema.voicemails).values({ boxId: box.id, recordingSid: "RE333", recordingUrl: "https://api.twilio.com/x/RE333", durationSec: 5, createdAt: new Date(Date.now() - 3600_000) });
    expect(await notifyStragglers()).toBe(1);
    expect(await notifyStragglers()).toBe(0);
  });

  it("urgent alerts start with URGENT; the audio route only ever fetches from Twilio", async () => {
    expect(voicemailAlertText({ fromNumber: null, durationSec: 65, transcription: null, urgent: true }, { name: "Main", isMain: true }, "L")).toBe("URGENT: Hup Up Attractions: new voicemail from a withheld number, 1:05. Listen: L");
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "x";
    expect(await fetchRecordingAudio({ recordingUrl: "https://evil.example/rec" })).toBeNull();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });
});
