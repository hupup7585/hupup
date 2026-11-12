import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Hotline voicemail end to end through handleVoice, on a throwaway in-memory Postgres (PGlite) with every
 * migration applied. Texts and emails are captured, nothing is sent.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAvm1", fromNumber: "+18455550199", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  sms: [] as { to: string; body: string; opts?: Record<string, unknown> }[],
  emails: [] as { to: string; subject: string; text?: string; attachments?: { filename: string; content: string }[] }[],
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
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, patch, patch.data ? { data: { ...h.session.data, ...patch.data } } : {}), // merges data like the real session
}));
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false })); // ringing rules: weekday (Phone Menu v3)
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => h.open }));
vi.mock("@/lib/notify", () => ({
  sendSms: async (to: string, body: string, opts?: Record<string, unknown>) => (h.sms.push({ to, body, opts }), { sent: true }),
  sendEmail: async (to: string, subject: string, text: string, attachments: { filename: string; content: string }[] = []) => (h.emails.push({ to, subject, text, attachments }), { sent: true }),
}));

import { handleVoice } from "@/lib/ivr/flow";
import { db, schema } from "@/lib/db";
import { alertWhen, fetchRecordingAudio, mainBox, notifyStragglers, voicemailAlert, voicemailSource } from "@/lib/voicemail";
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
  h.session.status = "in_progress";
});

describe("hotline voicemail", () => {
  it("office closed: the menu still offers 9 (feedback) and 0; 0 still rings (Phone Menu v3); 3 goes to voicemail with the approved greeting", async () => {
    const menu = await call("menu");
    expect(menu).toContain("For feedback and comments, press 9.");
    expect(menu).toContain("To speak with an operator, press 0.");
    expect(await call("ring", {}, "k=0")).toContain("<Dial");
    const closed = await call("ring", {}, "k=4");
    expect(closed).toContain("/api/voice/voicemail?x=4");
    expect(closed).not.toContain("Sorry, we missed your call"); // the voicemail greeting replaces the missed-call line
  });

  it("records into the Main box with a beep, transcription and callbacks; Main box alerts the owner by default", async () => {
    const first = await mainBox();
    expect(first.transcribe).toBe(false); // off by default (extra Twilio charge); the owner turns it on
    await db.update(schema.voicemailBoxes).set({ transcribe: true }).where(eq(schema.voicemailBoxes.id, first.id));
    h.open = true;
    const xml = await call("voicemail");
    const box = await mainBox();
    expect(box.notifySms).toEqual(["+18457777585"]);
    expect(box.notifyEmail).toEqual(["owner@example.com"]);
    expect(xml.replace(/&apos;/g, "'")).toContain("We apologize that we are unable to answer your call. Our team is assisting other customers right now. Please feel free to leave a message after the tone and we will get back to you as soon as possible. When you are finished, you may hang up or press the pound key.");
    expect(xml).toMatch(/<Record [^>]*finishOnKey="#"/);
    expect(xml).toMatch(/<Record [^>]*playBeep="true"/);
    expect(xml).toMatch(/transcribe="true"/);
    expect(xml).toContain(`vm-recording?b=${box.id}&amp;t=1`);
    expect(xml).toContain(`vm-transcription?b=${box.id}`);
    expect(xml).toContain(`vm-recorded?b=${box.id}`);
    expect(h.session.outcome).toBe("voicemail");
  });

  it("saves the recording once (Twilio retries), then emails the MP3 and texts the play link when the transcription arrives, once", async () => {
    const box = await mainBox();
    h.session.status = "completed"; // the caller hung up while recording; the file arrives after the call
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "tok";
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG1"; // texting approved
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([73, 68, 51, 1, 2, 3]), { status: 200 }));
    const rec = { RecordingStatus: "completed", RecordingSid: "RE111", RecordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/RE111", RecordingDuration: "42" };
    await call("vm-recording", rec, `b=${box.id}&t=1`);
    await call("vm-recording", rec, `b=${box.id}&t=1`);
    const rows = await db.select().from(schema.voicemails).where(eq(schema.voicemails.recordingSid, "RE111"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ fromNumber: "+18455550199", durationSec: 42, transcriptionStatus: "pending" });
    expect(h.sms).toHaveLength(0); // waits for the transcription

    await call("vm-transcription", { RecordingSid: "RE111", TranscriptionStatus: "completed", TranscriptionText: "Hi, I need a bounce house for Sunday." });
    await call("vm-transcription", { RecordingSid: "RE111", TranscriptionStatus: "completed", TranscriptionText: "Hi, I need a bounce house for Sunday." });
    const when = alertWhen(rows[0].createdAt);
    expect(when).toMatch(/^[A-Z][a-z]{2} \d{1,2}, 20\d\d at \d{1,2}:\d\d [AP]M$/);
    expect(h.sms).toHaveLength(1);
    expect(h.sms[0].to).toBe("+18457777585");
    expect(h.sms[0].body).toMatch(new RegExp(`^Hup Up Attractions: New voicemail on Extension 0, Operator, from \\(845\\) 555-0199, ${when}, 0:42 long\\. Play: https://hupup\\.example/api/voicemail/play/${rows[0].id}\\?exp=\\d+&sig=[0-9a-f]{32}$`));
    expect(h.sms[0].opts).toMatchObject({ kind: "system" });
    expect((h.sms[0].opts?.mediaUrls as string[])[0]).toMatch(/\/api\/voicemail\/play\//); // MMS on (Abraham, Nov 10)
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("owner@example.com");
    expect(h.emails[0].subject).toBe("New voicemail - Extension 0, Operator - (845) 555-0199");
    expect(h.emails[0].text).toContain("The recording is attached as an MP3 file.");
    expect(h.emails[0].text).toContain(`Date and time: ${when} (Eastern)`);
    expect(h.emails[0].text).toContain("Length: 0:42");
    expect(h.emails[0].attachments).toHaveLength(1);
    expect(h.emails[0].attachments![0].filename).toMatch(/\.mp3$/);
    expect(Buffer.from(h.emails[0].attachments![0].content, "base64")).toEqual(Buffer.from([73, 68, 51, 1, 2, 3]));
    fetchSpy.mockRestore();
  });

  it("before texting is approved: email only; if the recording can't be downloaded the email says so and keeps the link", async () => {
    const box = await mainBox();
    h.session.status = "completed";
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await call("vm-recording", { RecordingStatus: "completed", RecordingSid: "RE000", RecordingUrl: "https://api.twilio.com/x/RE000", RecordingDuration: "0" }, `b=${box.id}&t=0`);
    expect((await db.select().from(schema.voicemails).where(eq(schema.voicemails.recordingSid, "RE000"))).length).toBe(0);
    await call("vm-recording", { RecordingStatus: "completed", RecordingSid: "RE222", RecordingUrl: "https://api.twilio.com/x/RE222", RecordingDuration: "7" }, `b=${box.id}&t=0`);
    expect(h.sms).toHaveLength(0);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].attachments).toEqual([]);
    expect(h.emails[0].text).toContain("Recording attached failed, use the link.");
    expect(h.emails[0].text).toMatch(/Play it here \(private link, expires in 14 days\): https:\/\/hupup\.example\/api\/voicemail\/play\//);
    fetchSpy.mockRestore();
  });

  it("MMS with the MP3 once the Owner turns it on (small files only); key and box shown in words", async () => {
    h.session.status = "completed";
    const { saveSetting } = await import("@/lib/settings");
    await saveSetting("voicemailMms", true);
    process.env.TWILIO_MESSAGING_SERVICE_SID = "MG1";
    const box = await mainBox();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array(1000), { status: 200 }));
    await call("vm-recording", { RecordingStatus: "completed", RecordingSid: "RE444", RecordingUrl: "https://api.twilio.com/x/RE444", RecordingDuration: "9" }, `b=${box.id}&t=0`);
    expect(h.sms).toHaveLength(1);
    expect((h.sms[0].opts?.mediaUrls as string[])[0]).toMatch(/\/api\/voicemail\/play\/\d+\?exp=\d+&sig=/);
    fetchSpy.mockRestore();
    await saveSetting("voicemailMms", false);
    delete process.env.TWILIO_MESSAGING_SERVICE_SID;
    expect(voicemailSource({ name: "Main", isMain: true }, { menuKeys: ["0"], missed: "no_answer" })).toBe("Key 0 (no one answered)");
    expect(voicemailSource({ name: "Main", isMain: true }, { menuKeys: ["4"], missed: "closed" })).toBe("Key 4 (office closed)");
    expect(voicemailSource({ name: "Main", isMain: true }, { menuKeys: ["9"] })).toBe("Key 9 (voicemail)");
  });

  it("every box uses Abraham's approved greeting (an old custom greeting is not used); nothing recorded = no confirmation", async () => {
    const box = await mainBox();
    await db.update(schema.voicemailBoxes).set({ greetingText: "You reached Hup Up Attractions after hours. Leave a message!" }).where(eq(schema.voicemailBoxes.id, box.id));
    h.open = true;
    const xml = await call("voicemail");
    expect(xml).not.toContain("after hours");
    expect(xml).toContain("We apologize that we are unable to answer your call.");
    const none = await call("vm-recorded", { RecordingDuration: "0" }, `b=${box.id}`);
    expect(none).toContain("/api/voice/vm-none");
    const retry = (await call("vm-none", {}, `b=${box.id}`)).replace(/&apos;/g, "'");
    expect(retry).toContain("We didn't receive a message. To try again, press 3. Otherwise, you may hang up.");
    expect(retry).not.toContain("Your message has been sent");
    await db.update(schema.voicemailBoxes).set({ greetingText: null }).where(eq(schema.voicemailBoxes.id, box.id));
  });

  it("office open: 0 rings the office; if no one answers, the voicemail greeting then the tone", async () => {
    h.open = true;
    process.env.FORWARD_PHONE = "+18455550188";
    const dial = await call("ring", {}, "k=0");
    expect(dial).toMatch(/<Dial [^>]*action="[^"]*operator-done\?i=0&amp;k=0"/);
    const missed = await call("operator-done", { DialCallStatus: "no-answer" });
    expect(missed).toContain("/api/voice/voicemail?x=0");
    const vm = await call("voicemail", {}, "x=0");
    expect(vm).toContain("We apologize that we are unable to answer your call.");
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
    const a = voicemailAlert({ fromNumber: null, durationSec: 65, transcription: null, urgent: true, createdAt: new Date("2026-11-09T20:15:00Z") }, { callerName: null, box: "Extension 9, Feedback and Comments", playLink: "L", attached: true });
    expect(a.text).toBe("URGENT: Hup Up Attractions: New voicemail on Extension 9, Feedback and Comments, from a withheld number, Nov 9, 2026 at 3:15 PM, 1:05 long. Play: L");
    expect(a.subject).toBe("URGENT: New voicemail - Extension 9, Feedback and Comments - a withheld number");
    // Abraham's examples, exactly
    const ex = voicemailAlert({ fromNumber: "+18455550123", durationSec: 42, transcription: null, urgent: false, createdAt: new Date("2026-11-10T20:15:00Z") }, { callerName: null, box: "Extension 4, Customer Service", playLink: "L", attached: true });
    expect(ex.subject).toBe("New voicemail - Extension 4, Customer Service - (845) 555-0123");
    expect(ex.text.startsWith("Hup Up Attractions: New voicemail on Extension 4, Customer Service, from (845) 555-0123, Nov 10, 2026 at 3:15 PM, 0:42 long.")).toBe(true);
    const named = voicemailAlert({ fromNumber: "+18455550199", durationSec: 5, transcription: null, urgent: false, createdAt: new Date("2026-11-09T20:15:00Z") }, { callerName: "Mrs. Klein", box: "Extension 0, Operator", playLink: "L", attached: true });
    expect(named.email).toContain("Caller: Mrs. Klein (845) 555-0199");
    process.env.TWILIO_ACCOUNT_SID = "AC1";
    process.env.TWILIO_AUTH_TOKEN = "x";
    expect(await fetchRecordingAudio({ recordingUrl: "https://evil.example/rec" })).toBeNull();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
  });
});

describe("Voicemail settings screen (Abraham, Nov 9, 2026)", () => {
  it("text part says 'Not active yet: waiting for Twilio A2P'; MMS switch is off by default and explains the cost", async () => {
    const { readFileSync } = await import("node:fs");
    const { SETTING_DEFAULTS } = await import("@/lib/settings");
    const { textingActive, TEXT_ALERTS_NOT_ACTIVE } = await import("@/lib/voicemail");
    expect(SETTING_DEFAULTS.voicemailMms).toBe(true); // Abraham turned it on (Nov 10, 2026)
    expect(TEXT_ALERTS_NOT_ACTIVE).toBe("Not active yet: waiting for Twilio A2P");
    expect(textingActive({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t" })).toBe(false);
    expect(textingActive({ TWILIO_ACCOUNT_SID: "AC", TWILIO_AUTH_TOKEN: "t", TWILIO_MESSAGING_SERVICE_SID: "MG" })).toBe(true);
    const page = readFileSync("src/app/admin/(app)/voicemail/page.tsx", "utf8");
    expect(page).toContain('data-not-active="voicemail-text"');
    expect(page).toContain('name="voicemailMms"');
    expect(readFileSync("src/app/admin/(app)/voicemail/actions.ts", "utf8")).toContain('saveSetting("voicemailMms", form.get("voicemailMms") === "on", s.userId)');
  });
});
