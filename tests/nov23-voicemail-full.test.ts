import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/* Full voicemail by phone (Abraham, Nov 23, 2026): star 7 4 from key 9. Twilio, R2 and email are stand-ins. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAvmf", fromNumber: "+18457777585", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  from: "+18457777585",
  emails: [] as { to: string; subject: string; body: string; files: string[]; base64?: boolean }[],
  r2: new Map<string, number>(),
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({
  sendSms: async () => ({ sent: true }),
  sendEmail: async (to: string, subject: string, body: string, files: { filename: string; content: unknown }[] = []) => (h.emails.push({ to, subject, body, files: files.map((f) => f.filename), base64: files.every((f) => typeof f.content === "string") }), { sent: true }),
}));
vi.mock("@/lib/r2", () => ({
  r2Ready: () => true,
  r2Put: async (k: string, d: Uint8Array) => void h.r2.set(k, d.byteLength),
  r2Get: async () => new Response(new Uint8Array([1, 2, 3])),
  r2Delete: async (k: string) => void h.r2.delete(k),
  r2Used: async () => 0,
}));
vi.mock("@/lib/vm-audio", async (orig) => {
  const real = await orig<typeof import("@/lib/vm-audio")>();
  return {
    ...real,
    // three 5-second pieces per message (the real cutter is tested below)
    ensurePieces: async (v: { id: number; audioOf: number | null }) => {
      const id = v.audioOf ?? v.id;
      for (let i = 0; i < 3; i++) h.r2.set(real.pieceKey(id, i), 10);
      const { db, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      await db.update(schema.voicemails).set({ pieces: 3 }).where(eq(schema.voicemails.id, id));
      return 3;
    },
    saveRecordingToR2: async (_u: string, key: string) => (h.r2.set(key, 10), true),
  };
});
vi.mock("@/lib/voicemail", async (orig) => ({ ...(await orig<typeof import("@/lib/voicemail")>()), fetchRecordingAudio: async () => new Response(new Uint8Array([9, 9])), notifyVoicemail: async () => ({ sent: 0 }) }));

import { db, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAvmf", ...body }, callSid: "CAvmf", from: h.from });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1].replace(/&apos;/g, "'"));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const STAR = "To go back, press star.";
const NOT_VALID = "Sorry, that is not a valid selection. Please try again.";
let owner = 0;
let ownerBox = 0;
let secBox = 0;
let mainBoxId = 0;
let m1 = 0;
let m2 = 0;

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  const [o] = await db.insert(schema.adminUsers).values({ name: "Abraham", phone: "+18457777585", email: "owner@example.com", role: "owner", active: true }).returning();
  await db.insert(schema.adminUsers).values({ name: "Sara", phone: "+18455550111", email: "sara@example.com", role: "secretary", active: true });
  owner = o.id;
  const { ensurePersonalBoxes } = await import("@/lib/vm-boxes");
  const boxes = await ensurePersonalBoxes();
  ownerBox = boxes.find((b) => b.ownerUserId === owner)!.id;
  secBox = boxes.find((b) => b.ownerUserId !== owner)!.id;
  expect(boxes.find((b) => b.id === ownerBox)!.boxNumber).toBe("1");
  expect(boxes.find((b) => b.id === secBox)!.boxNumber).toBe("2");
  const { mainBox } = await import("@/lib/voicemail");
  mainBoxId = (await mainBox()).id;
  const at = new Date("2026-11-23T19:42:00Z"); // Monday, Nov 23, 2:42 PM in New York
  const [a] = await db.insert(schema.voicemails).values({ boxId: ownerBox, fromNumber: "+18457777585", recordingSid: "RE1", recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE1", durationSec: 14, state: "submitted", createdAt: at, transcriptionStatus: "off" }).returning();
  const [b] = await db.insert(schema.voicemails).values({ boxId: ownerBox, fromNumber: "+18455550222", recordingSid: "RE2", recordingUrl: "https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/RE2", durationSec: 8, state: "submitted", createdAt: at, transcriptionStatus: "off" }).returning();
  m1 = a.id;
  m2 = b.id;
});
beforeEach(() => {
  h.emails.length = 0;
});

describe("sign in", () => {
  it("star 7 4 from the general voicemail; caller ID picks the box; the box's own password (1234 until changed)", async () => {
    expect(redirect(await call("vm-greeting-key", { Digits: "*74" }, "x=9"))).toBe("vm-start");
    expect(redirect(await call("vm-start"))).toBe(`vm-pass?b=${ownerBox}`);
    expect(said(await call("vm-pass", {}, `b=${ownerBox}`))).toEqual(["Please enter your password, then press pound."]);
    expect(redirect(await call("vm-pass-heard", { Digits: "1234" }, `b=${ownerBox}`))).toBe("vm-main");
  });
  it("another phone: the box number first", async () => {
    h.from = "+18455550999";
    h.session.fromNumber = h.from;
    expect(redirect(await call("vm-start"))).toBe("vm-num");
    expect(said(await call("vm-num"))).toEqual(["Please enter your box number, then press pound."]);
    expect(redirect(await call("vm-num-heard", { Digits: "2" }))).toBe(`vm-pass?b=${secBox}`);
    const bad = await call("vm-num-heard", { Digits: "77" });
    expect(said(bad)).toEqual([NOT_VALID]);
    h.from = "+18457777585";
    h.session.fromNumber = h.from;
  });
  it("lockout: 3 wrong passwords lock the box for 15 minutes and email the Owner", async () => {
    process.env.ADMIN_EMAIL = "owner@example.com";
    for (const pin of ["1111", "2222"]) expect(said(await call("vm-pass-heard", { Digits: pin }, `b=${secBox}`))).toEqual(["That password is not correct. Please try again."]);
    const third = await call("vm-pass-heard", { Digits: "3333" }, `b=${secBox}`);
    expect(said(third)).toEqual(["Voicemail access is locked for now. Please try again later. Goodbye."]);
    expect(third).toContain("<Hangup/>");
    expect(h.emails[0].subject).toMatch(/voicemail box 2 locked/);
    expect(said(await call("vm-pass", {}, `b=${secBox}`))).toEqual(["Voicemail access is locked for now. Please try again later. Goodbye."]);
    await db.update(schema.voicemailBoxes).set({ lockedUntil: null }).where(eq(schema.voicemailBoxes.id, secBox));
  });
});

describe("main menu and messages", () => {
  it("the counts, then the menu; a wrong key; no key repeats once", async () => {
    await call("vm-pass-heard", { Digits: "1234" }, `b=${ownerBox}`);
    const main = said(await call("vm-main"));
    expect(main[0]).toBe("You have 2 new messages and 0 saved messages.");
    expect(main[1]).toBe("For new messages, press 1. To send a message, press 2. For saved messages, press 3. For greetings, press 4. For personal options, press 5. For deleted messages, press 6. To exit, press star.");
    expect(said(await call("vm-main-key", { Digits: "9" }))).toEqual([NOT_VALID]);
    expect(redirect(await call("vm-main"))).toBe("vm-main?s=1&r=1");
    expect(redirect(await call("vm-main", {}, "s=1&r=1"))).toBe("vm-bye");
  });
  it("listen: date, time and number digit by digit; the keys once; 5-second pieces", async () => {
    expect(redirect(await call("vm-main-key", { Digits: "1" }))).toBe(`vm-list?b=${ownerBox}&m=new`);
    expect(redirect(await call("vm-list", {}, `b=${ownerBox}&m=new`))).toBe(`vm-msg?b=${ownerBox}&m=new&v=${m1}`);
    const msg = said(await call("vm-msg", {}, `b=${ownerBox}&m=new&v=${m1}`));
    expect(msg[0]).toBe("Message received Monday, November twenty-third, at 2:42 PM, from 8 4 5, 7 7 7, 7 5 8 5.");
    expect(msg[1]).toMatch(/^During a message: to go back 5 seconds, press 1\. To pause, press 2\./);
    expect(msg.join(" ")).not.toMatch(/slower|faster/i);
    const piece = await call("vm-piece", {}, `b=${ownerBox}&m=new&v=${m1}&p=0`);
    expect(piece).toMatch(/<Gather [^>]*timeout="1"[^>]*><Play>[^<]*voicemail%2F\d+%2F0\.wav/);
    expect(redirect(piece)).toBe(`vm-piece?b=${ownerBox}&m=new&v=${m1}&p=1`);
  });
  it("during: 1 back 5 seconds, 3 forward, 2 pause and continue, 5 date again, pound to the end", async () => {
    const k = (d: string, p: number) => call("vm-pkey", { Digits: d }, `b=${ownerBox}&m=new&v=${m1}&p=${p}&n=3`);
    expect(redirect(await k("1", 2))).toBe(`vm-piece?b=${ownerBox}&m=new&v=${m1}&p=1`);
    expect(redirect(await k("3", 0))).toBe(`vm-piece?b=${ownerBox}&m=new&v=${m1}&p=1`);
    expect(redirect(await k("2", 1))).toBe(`vm-pause?b=${ownerBox}&m=new&v=${m1}&p=1`);
    expect(said(await call("vm-pause", {}, `b=${ownerBox}&m=new&v=${m1}&p=1`))).toEqual(["Paused. To continue, press 2."]);
    expect(redirect(await call("vm-pause-key", { Digits: "2" }, `b=${ownerBox}&m=new&v=${m1}&p=1`))).toBe(`vm-piece?b=${ownerBox}&m=new&v=${m1}&p=1`);
    expect(said(await k("5", 1))[0]).toMatch(/^Message received Monday, November twenty-third/);
    expect(redirect(await k("#", 1))).toBe(`vm-after?b=${ownerBox}&m=new&v=${m1}`);
    expect(said(await k("4", 1))).toEqual([NOT_VALID]); // slower is left out
  });
  it("after: the menu ends with the star line; 9 saves, then the next message; pound keeps it new", async () => {
    expect(said(await call("vm-after", {}, `b=${ownerBox}&m=new&v=${m1}`))).toEqual(["To replay, press 4. For the date and number, press 5. To forward, press 6. To erase, press 7. To reply, press 8. To save, press 9. To keep it as new, press pound.", STAR]);
    const saved = await call("vm-act", { Digits: "9" }, `b=${ownerBox}&m=new&v=${m1}`);
    expect(said(saved)).toEqual(["Message saved."]);
    expect(redirect(saved)).toBe(`vm-msg?b=${ownerBox}&m=new&v=${m2}`);
    const kept = await call("vm-act", { Digits: "#" }, `b=${ownerBox}&m=new&v=${m2}`);
    expect(said(kept)).toEqual(["Message kept as new.", "You have no more messages."]);
  });
  it("erase goes to deleted messages; 9 restores to saved; 7 then 7 erases forever (pieces deleted)", async () => {
    expect(said(await call("vm-act", { Digits: "7" }, `b=${ownerBox}&m=new&v=${m2}`))[0]).toBe("Message erased.");
    expect(said(await call("vm-list", {}, `b=${ownerBox}&m=deleted`))).toEqual(["You have 1 deleted messages. They are kept for 30 days."]);
    expect(said(await call("vm-after", {}, `b=${ownerBox}&m=deleted&v=${m2}`))[0]).toBe("To restore this message to saved messages, press 9. To erase it forever, press 7. For the next message, press pound.");
    expect(said(await call("vm-act", { Digits: "9" }, `b=${ownerBox}&m=deleted&v=${m2}`))[0]).toBe("Message restored.");
    const { listMessages } = await import("@/lib/vm-boxes");
    expect((await listMessages(ownerBox, "saved")).map((x) => x.id)).toEqual([m1, m2]);
    await call("vm-act", { Digits: "7" }, `b=${ownerBox}&m=saved&v=${m2}`);
    expect(said(await call("vm-erase", {}, `b=${ownerBox}&m=deleted&v=${m2}`))).toEqual(["To erase this message forever, press 7 again.", STAR]);
    await call("vm-piece", {}, `b=${ownerBox}&m=deleted&v=${m2}&p=0`); // the pieces exist
    expect(h.r2.has(`voicemail/${m2}/0.wav`)).toBe(true);
    expect(said(await call("vm-erase-key", { Digits: "7" }, `b=${ownerBox}&m=deleted&v=${m2}`))[0]).toBe("Message erased forever.");
    expect(h.r2.has(`voicemail/${m2}/0.wav`)).toBe(false);
    expect(await listMessages(ownerBox, "deleted")).toHaveLength(0);
  });
});

describe("forward, reply, send", () => {
  it("forward to another box (with a recorded note) and by email as an mp3", async () => {
    expect(said(await call("vm-fwd", {}, `b=${ownerBox}&m=saved&v=${m1}`))).toEqual(["To forward to another voicemail box, press 1. To forward by email, press 2.", STAR]);
    const list = said(await call("vm-fwd-list", {}, `b=${ownerBox}&m=saved&v=${m1}&t=box`));
    expect(list).toContain("For Sara, press 1.");
    expect(redirect(await call("vm-fwd-pick", { Digits: "1" }, `b=${ownerBox}&m=saved&v=${m1}&t=box`))).toMatch(/^vm-note\?/);
    expect(said(await call("vm-note", {}, `b=${ownerBox}&m=saved&v=${m1}&t=box&to=${secBox}`))).toEqual(["To add a recorded note before the message, press 1. Otherwise, stay on the line."]);
    expect(await call("vm-note-key", { Digits: "1" }, `b=${ownerBox}&m=saved&v=${m1}&t=box&to=${secBox}`)).toMatch(/Please record your note after the tone\.[\s\S]*<Record [^>]*playBeep="true"/);
    const done = await call("vm-note-done", { RecordingUrl: "https://api.twilio.com/x/REnote" }, `b=${ownerBox}&m=saved&v=${m1}&t=box&to=${secBox}`);
    const fwd = await call(redirect(done)!.split("?")[0], {}, redirect(done)!.split("?")[1]);
    expect(said(fwd)).toEqual(["Message forwarded."]);
    const { listMessages } = await import("@/lib/vm-boxes");
    const copy = (await listMessages(secBox, "new"))[0];
    expect(copy).toMatchObject({ audioOf: m1, fromBoxId: ownerBox });
    expect(copy.noteKey).toMatch(/^voicemail\/note\//);
    // by email
    await call("vm-fwd-do", {}, `b=${ownerBox}&m=saved&v=${m1}&t=mail&to=${owner}`);
    expect(h.emails[0]).toMatchObject({ to: "owner@example.com", files: [`voicemail-${m1}.mp3`], base64: true }); // deep check 06:00 M14
    expect(h.emails[0].body).toContain("Received: Monday, November twenty-third, at 2:42 PM");
  });
  it("reply: a voice reply only to a message from a box; call back stays off", async () => {
    expect(said(await call("vm-reply-key", { Digits: "1" }, `b=${ownerBox}&m=saved&v=${m1}`))).toEqual(["This message did not come from a voicemail box, so a voice reply is not available."]);
    expect(said(await call("vm-reply-key", { Digits: "2" }, `b=${ownerBox}&m=saved&v=${m1}`))).toEqual(["Calling back is not available yet."]);
  });
  it("send: pick a box, record after the tone, then 1 send, 2 listen, 3 record again, star cancel", async () => {
    const pick = said(await call("vm-send"));
    expect(pick[0]).toBe("Please choose a box.");
    expect(pick.at(-1)).toBe(STAR);
    const rec = await call("vm-send-key", { Digits: "2" });
    expect(rec).toMatch(/Please record your message after the tone\. When you are finished, press pound\.[\s\S]*<Record [^>]*finishOnKey="#"/);
    const done = await call("vm-rec-done", { RecordingUrl: "https://api.twilio.com/x/REsend", RecordingSid: "REsend", RecordingDuration: "6" }, `to=${secBox}&k=send`);
    const review = redirect(done)!;
    expect(said(await call("vm-rec-review", {}, review.split("?")[1]))).toEqual(["To send it, press 1. To listen to it, press 2. To record it again, press 3.", STAR]);
    const id = new URLSearchParams(review.split("?")[1]).get("id");
    const { listMessages } = await import("@/lib/vm-boxes");
    const before = (await listMessages(secBox, "new")).length;
    expect(said(await call("vm-rec-key", { Digits: "1" }, review.split("?")[1]))).toEqual(["Message sent."]);
    expect((await listMessages(secBox, "new")).length).toBe(before + 1);
    expect((await listMessages(secBox, "new")).find((x) => String(x.id) === id)?.fromBoxId).toBe(ownerBox);
  });
});

describe("greetings and personal options", () => {
  it("greetings: listen (none yet), record with the review (keep), standard greeting", async () => {
    expect(said(await call("vm-greet"))).toEqual(["To listen to your greeting, press 1. To record a personal greeting, press 2. To use the standard greeting, press 3.", STAR]);
    expect(said(await call("vm-greet-key", { Digits: "1" }))).toEqual(["You do not have a personal greeting."]);
    const g = redirect(await call("vm-grec-done", { RecordingUrl: "https://api.twilio.com/x/REgreet" }, "k=greeting"))!;
    expect(said(await call("vm-grev", {}, g.split("?")[1]))).toEqual(["To keep it, press 1. To listen to it, press 2. To record it again, press 3.", STAR]);
    expect(said(await call("vm-grev-key", { Digits: "1" }, g.split("?")[1]))).toEqual(["Your greeting is saved."]);
    const { getBox } = await import("@/lib/vm-boxes");
    expect((await getBox(ownerBox))?.greetingKey).toMatch(/^voicemail\/greeting\//);
    expect(said(await call("vm-greet-key", { Digits: "3" }))).toEqual(["You are now using the standard greeting."]);
    expect((await getBox(ownerBox))?.greetingKey).toBeNull();
  });
  it("password change: 4 to 8 digits, twice; the new one signs in", async () => {
    expect(said(await call("vm-opts"))).toEqual(["To change your password, press 1. To record your name, press 2. To turn new message alerts on or off, press 3.", STAR]);
    expect(said(await call("vm-np2", { Digits: "12" }))).toEqual(["The passwords did not match. Please try again."]);
    await call("vm-np2", { Digits: "482193" });
    expect(said(await call("vm-np-save", { Digits: "482199" }))).toEqual(["The passwords did not match. Please try again."]);
    await call("vm-np2", { Digits: "482193" });
    expect(said(await call("vm-np-save", { Digits: "482193" }))).toEqual(["Your password is changed."]);
    expect(said(await call("vm-pass-heard", { Digits: "1234" }, `b=${ownerBox}`))).toEqual(["That password is not correct. Please try again."]);
    expect(redirect(await call("vm-pass-heard", { Digits: "482193" }, `b=${ownerBox}`))).toBe("vm-main");
  });
  it("alerts on and off; shared boxes from key 8; every action is logged for Admin", async () => {
    expect(said(await call("vm-opts-key", { Digits: "3" }))).toEqual(["New message alerts are now off."]);
    expect(said(await call("vm-opts-key", { Digits: "3" }))).toEqual(["New message alerts are now on."]);
    expect(said(await call("vm-shared")).join(" ")).toMatch(/press 1\./);
    expect(redirect(await call("vm-shared-key", { Digits: "1" }))).toBe(`vm-sbox?b=${mainBoxId}`);
    const log = await db.select().from(schema.voicemailActions);
    const what = log.map((r) => r.action);
    for (const a of ["Signed in by phone", "Wrong password", "Locked after 3 wrong passwords", "Saved", "Restored to saved", "Erased forever", "Changed the password", "Recorded a personal greeting"]) expect(what, a).toContain(a);
    expect(what.some((a) => a.startsWith("Forwarded by email"))).toBe(true);
    expect(log.find((r) => r.action === "Saved")?.userId).toBe(owner);
  });
});

describe("5-second pieces", () => {
  it("a WAV file is cut into complete 5-second WAV pieces", async () => {
    const { splitWav } = await import("@/lib/vm-audio");
    const rate = 8000;
    const seconds = 12;
    const data = new Uint8Array(rate * 2 * seconds);
    const wav = new Uint8Array(44 + data.byteLength);
    const dv = new DataView(wav.buffer);
    wav.set([82, 73, 70, 70], 0);
    dv.setUint32(4, 36 + data.byteLength, true);
    wav.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
    dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true);
    dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true);
    dv.setUint16(32, 2, true);
    dv.setUint16(34, 16, true);
    wav.set([100, 97, 116, 97], 36);
    dv.setUint32(40, data.byteLength, true);
    const parts = splitWav(wav);
    expect(parts).toHaveLength(3); // 5 + 5 + 2 seconds
    expect(parts[0].byteLength).toBe(44 + rate * 2 * 5);
    expect(parts[2].byteLength).toBe(44 + rate * 2 * 2);
    expect(String.fromCharCode(...parts[1].subarray(0, 4))).toBe("RIFF");
  });
});
