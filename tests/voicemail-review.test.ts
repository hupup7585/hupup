import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Voicemail greeting and review menu (Abraham, Nov 11, 2026), every path, end to end through handleVoice on an
 * in-memory Postgres. Emails are captured; nothing is sent.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CArv", fromNumber: "+18455550166", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  emails: [] as { to: string; subject: string; text?: string }[],
  open: true,
}));
vi.mock("@/lib/business-hours", async (orig) => ({ ...(await orig<typeof import("@/lib/business-hours")>()), officeOpenNow: () => h.open }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: { data?: Record<string, unknown> } & Record<string, unknown>) => {
    const { data, ...rest } = patch;
    Object.assign(h.session, rest);
    if (data) h.session.data = { ...h.session.data, ...data };
  },
}));
vi.mock("@/lib/jewish-calendar", async (orig) => ({ ...(await orig<typeof import("@/lib/jewish-calendar")>()), isShabbosOrYomTov: () => false })); // ringing rules: weekday (Phone Menu v3)
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({
  sendSms: async () => ({ sent: true }),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleCallStatus, handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { HUNG_UP_UNCONFIRMED_NOTE, boxForKey, mainBox } from "@/lib/voicemail";
import { saveSetting } from "@/lib/settings";

let sidN = 0;
const call = (action: string, body: Record<string, string> = {}, query = "") =>
  handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: h.session.callSid, ...body }, callSid: h.session.callSid, from: "+18455550166" });
const plain = (x: string) => x.replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const rec = (sid: string, extra: Record<string, string> = {}) => ({ RecordingSid: sid, RecordingUrl: `https://api.twilio.com/2010-04-01/Accounts/AC1/Recordings/${sid}`, RecordingDuration: "9", ...extra });
const row = async (sid: string) => (await db.select().from(schema.voicemails).where(eq(schema.voicemails.recordingSid, sid)))[0];
const ready = (sid: string, b: number) => call("vm-recording", { RecordingStatus: "completed", ...rec(sid) }, `b=${b}&t=0`);

beforeAll(() => {
  process.env.ADMIN_EMAIL = "owner@example.com";
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
});
beforeEach(() => {
  h.emails.length = 0;
  h.session.callSid = `CArv${++sidN}`;
  h.session.data = {};
  h.session.status = "in_progress";
  h.open = true;
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
});

describe("approved wording, every box", () => {
  it("greeting, options and confirmation word for word", () => {
    expect(PROMPTS.vm_greeting.text).toBe("We apologize that we are unable to answer your call. Our team is assisting other customers right now. Please feel free to leave a message after the tone and we will get back to you as soon as possible. When you are finished, you may hang up or press the pound key.");
    expect(PROMPTS.vm_options.text).toBe("Thank you!\nTo send your message, press 1.\nTo listen to it, press 2.\nTo delete and re-record, press 3.");
    expect(PROMPTS.vm_sent.text).toBe("Thank you! Your message has been sent. We will get back to you as soon as possible. Goodbye!");
  });
  it("each extension has its own box (named from Admin, alerts copied from Main); the greeting plays there too", async () => {
    const main = await mainBox();
    const xml = plain(await call("voicemail", {}, "x=4"));
    const b4 = await boxForKey("4");
    expect(b4.name).toBe("Extension 3, Customer Service"); // customer service is key 3 now (same box as before)
    expect(b4.notifyEmail).toEqual(main.notifyEmail);
    expect(b4.id).not.toBe(main.id);
    expect(xml).toContain(PROMPTS.vm_greeting.text);
    expect(xml).toContain(`vm-recorded?b=${b4.id}&x=4`);
    await saveSetting("ringName4", "Customer Care");
    await call("voicemail", {}, "x=4");
    expect((await boxForKey("4")).name).toBe("Extension 3, Customer Care"); // renamed in Admin: the box follows
    await saveSetting("ringName4", "");
    expect((await boxForKey("0")).id).toBe(main.id); // key 0 and 9 use Main
  });
});

describe("every path", () => {
  it("hang up while recording: saved and sent as is (no confirmation needed)", async () => {
    const b = (await mainBox()).id;
    await call("vm-recorded", rec("REhang", { Digits: "hangup" }), `b=${b}`);
    await ready("REhang", b);
    expect((await row("REhang")).state).toBe("submitted");
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].text).not.toContain(HUNG_UP_UNCONFIRMED_NOTE);
  });

  it("# then 1: options, then saved, the confirmation, end of call", async () => {
    const b = (await mainBox()).id;
    const opts = plain(await call("vm-recorded", rec("RE1", { Digits: "#" }), `b=${b}`));
    expect(opts).toContain("/api/voice/vm-options");
    expect(plain(await call("vm-options"))).toContain("Thank you!\nTo send your message, press 1.\nTo listen to it, press 2.\nTo delete and re-record, press 3.");
    await ready("RE1", b);
    expect(h.emails).toHaveLength(0); // not sent until 1
    const done = plain(await call("vm-option", { Digits: "1" }));
    expect(done).toContain(PROMPTS.vm_sent.text);
    expect(done).toContain("<Hangup/>");
    expect((await row("RE1")).state).toBe("submitted");
    expect(h.emails).toHaveLength(1);
  });

  it("# then 2: plays the recording through our own server (signed link, Twilio login on our side), then the options again", async () => {
    const b = (await mainBox()).id;
    await call("vm-recorded", rec("RE2", { Digits: "#" }), `b=${b}`);
    const listen = plain(await call("vm-option", { Digits: "2" }));
    const id = (await row("RE2")).id;
    expect(listen).toMatch(new RegExp(`<Play>https://hupup\\.example/api/voicemail/play/${id}\\?exp=\\d+&sig=[0-9a-f]+</Play>`));
    expect(listen).not.toContain("api.twilio.com");
    expect(listen).toContain("/api/voice/vm-options");
    expect((await row("RE2")).state).toBe("reviewing");
  });

  it("# then 3: records again; the new one replaces the old, then the options after #; only the new one is sent", async () => {
    const b = (await mainBox()).id;
    await call("vm-recorded", rec("RE3a", { Digits: "#" }), `b=${b}`);
    const again = plain(await call("vm-option", { Digits: "3" }));
    expect(again).toMatch(/<Record [^>]*finishOnKey="#"/);
    expect(again).not.toContain("We apologize"); // no second greeting
    await call("vm-recorded", rec("RE3b", { Digits: "#" }), `b=${b}`);
    expect((await row("RE3a")).state).toBe("replaced");
    await ready("RE3a", b);
    await ready("RE3b", b);
    await call("vm-option", { Digits: "1" });
    expect((await row("RE3b")).state).toBe("submitted");
    expect(h.emails).toHaveLength(1);
    expect((await row("RE3a")).notifiedAt).toBeNull(); // the replaced take never goes out
  });

  it("# then hang up: kept as a voicemail, with Abraham's note on the email and text alert", async () => {
    const b = (await mainBox()).id;
    await call("vm-recorded", rec("RE4", { Digits: "#" }), `b=${b}`);
    await ready("RE4", b);
    expect(h.emails).toHaveLength(0);
    await handleCallStatus(h.session.callSid, "completed");
    const r = await row("RE4");
    expect(r.state).toBe("submitted");
    expect(r.note).toBe("The customer hung up without confirming or deleting this message.");
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].text).toContain("The customer hung up without confirming or deleting this message.");
  });

  it("# then hang up, and the audio file arrives after the call ended: still kept with the note", async () => {
    const b = (await mainBox()).id;
    await call("vm-recorded", rec("RE5", { Digits: "#" }), `b=${b}`);
    await handleCallStatus(h.session.callSid, "completed");
    expect(h.emails).toHaveLength(0); // waits for the file
    await ready("RE5", b);
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].text).toContain(HUNG_UP_UNCONFIRMED_NOTE);
  });

  it("no recording: Abraham's line, 3 tries again, anything else repeats it; never the confirmation", async () => {
    const b = (await mainBox()).id;
    const none = plain(await call("vm-recorded", { RecordingDuration: "0" }, `b=${b}`));
    expect(none).toContain(`/api/voice/vm-none?b=${b}`);
    const line = plain(await call("vm-none", {}, `b=${b}`));
    expect(line).toContain("We didn't receive a message. To try again, press 3. Otherwise, you may hang up.");
    expect(line).not.toContain(PROMPTS.vm_sent.text);
    expect(line).toContain("/api/voice/no-key?to=vm-none"); // repeats (3 plays and 20 seconds rule)
    expect(plain(await call("vm-none-choice", { Digits: "3" }, `b=${b}`))).toMatch(/<Record [^>]*finishOnKey="#"/);
    expect(plain(await call("vm-none-choice", { Digits: "5" }, `b=${b}`))).toContain("/api/voice/vm-none");
    expect(await call("vm-option", { Digits: "1" })).not.toContain("Your message has been sent");
    expect(PROMPTS.vm_none_retry.text).toBe("We didn't receive a message. To try again, press 3. Otherwise, you may hang up.");
  });

  it("no key: the options repeat; after 3 plays AND 20 seconds the call ends and the message is kept (Abraham, Nov 11)", async () => {
    const b = (await mainBox()).id;
    await call("vm-recorded", rec("RE6", { Digits: "#" }), `b=${b}`);
    await ready("RE6", b);
    expect(plain(await call("vm-option", { Digits: "7" }))).toContain("/api/voice/vm-options"); // wrong key: the options again
    const t0 = Date.now();
    expect(plain(await call("vm-options", {}, `np=1&t0=${t0}`))).toContain(`/api/voice/no-key?to=vm-options&np=2&t0=${t0}`);
    expect(plain(await call("no-key", {}, `to=vm-options&np=3&t0=${t0}`))).toContain("/api/voice/vm-options?np=3"); // under 20 seconds: again
    const end = plain(await call("no-key", {}, `to=vm-options&np=3&t0=${t0 - 21_000}`));
    expect(end).toContain("<Hangup/>");
    expect((await row("RE6")).state).toBe("reviewing");
    await handleCallStatus(h.session.callSid, "completed"); // the call ended: the message is kept
    expect((await row("RE6")).state).toBe("submitted");
    expect(h.emails).toHaveLength(1);
  });

  it("office closed (after hours, Shabbos, Yom Tov): Abraham's after-hours greeting in every box except key 9", async () => {
    h.open = false;
    const closed = plain(await call("voicemail", {}, "x=4"));
    expect(closed).toContain("Thank you for calling Hup Up Attractions! Our office is closed right now. Please leave your name, phone number, and a short message after the tone, and we'll call you back as soon as we open. To see our rentals anytime, visit hupupattractions.com. Have a wonderful day!"); // approved Nov 13, 2026
    expect(closed).not.toContain("Our team is assisting other customers right now");
    expect(plain(await call("voicemail", {}, "x=0"))).toContain("Our office is closed right now.");
    expect(plain(await call("voicemail", {}, "x=9"))).toContain(PROMPTS.vm9_greeting.text); // key 9 keeps its own greeting
    h.open = true;
    expect(plain(await call("voicemail", {}, "x=4"))).toContain("Our team is assisting other customers right now.");
  });

  it("every greeting and confirmation is editable in Admin (Hotline prompts), starting from the approved wording", async () => {
    const { promptText } = await import("@/lib/ivr/prompts");
    for (const k of ["vm_greeting", "vm_closed", "vm9_greeting", "vm_options", "vm_sent", "vm9_sent", "vm_none_retry"] as const) {
      expect(PROMPTS[k].group).toBe("Voicemail");
      expect(promptText({ [k]: { text: "Edited in Admin", audioUrl: null } }, k)).toBe("Edited in Admin");
    }
  });

  it("messages the caller is still deciding on never show in Admin", async () => {
    const { listVoicemails } = await import("@/lib/voicemail");
    const b = (await mainBox()).id;
    await call("vm-recorded", rec("RE7", { Digits: "#" }), `b=${b}`);
    expect((await listVoicemails()).map((v) => v.recordingSid)).not.toContain("RE7");
  });
});

describe("key 9: feedback and comments (Abraham, word for word)", () => {
  it("own greeting and confirmation; same tone, # and 1, 2, 3 options; its own box", async () => {
    expect(PROMPTS.vm9_greeting.text).toBe("Thank you for your time. We want to hear from you, your feedback helps us improve our service. Please share your comments after the tone. If you would like a callback, please say your name and phone number. When you're finished, you may hang up or press the pound key.");
    expect(PROMPTS.vm9_sent.text).toBe("Thank you for your feedback! We truly appreciate it. Goodbye!");
    expect(plain(await call("menu-choice", { Digits: "9" }))).toContain("/api/voice/voicemail?x=9");
    const xml = plain(await call("voicemail", {}, "x=9"));
    expect(xml).toContain(PROMPTS.vm9_greeting.text);
    expect(xml).not.toContain(PROMPTS.vm_greeting.text);
    expect(xml).toMatch(/<Record [^>]*finishOnKey="#"/);
    const b9 = await boxForKey("9");
    expect(b9.name).toBe("Extension 9, Feedback and Comments");
    expect(b9.id).not.toBe((await mainBox()).id);
    await call("vm-recorded", rec("RE9", { Digits: "#" }), `b=${b9.id}&x=9`);
    expect(plain(await call("vm-options"))).toContain("To delete and re-record, press 3.");
    await ready("RE9", b9.id);
    const done = plain(await call("vm-option", { Digits: "1" }));
    expect(done).toContain(PROMPTS.vm9_sent.text);
    expect(done).not.toContain(PROMPTS.vm_sent.text);
  });
});

describe("alerts say which box, first (Abraham)", () => {
  it("subject and text start with the extension number and its Admin name; renaming updates the next alert", async () => {
    const b4 = await boxForKey("4");
    await call("vm-recorded", rec("REa4", { Digits: "hangup" }), `b=${b4.id}&x=4`);
    await ready("REa4", b4.id);
    expect(h.emails.at(-1)!.subject).toBe("New voicemail - Extension 3, Customer Service - (845) 555-0166");
    expect(h.emails.at(-1)!.text!.startsWith("New voicemail on Extension 3, Customer Service.")).toBe(true);
    expect(h.emails.at(-1)!.text).toMatch(/Date and time: [A-Z][a-z]{2} \d{1,2}, 20\d\d at \d{1,2}:\d\d [AP]M \(Eastern\)/);
    expect(h.emails.at(-1)!.text).toContain("Length: 0:09");
    await saveSetting("ringName4", "Customer Care");
    h.session.callSid = "CArename";
    await call("vm-recorded", rec("REa4b", { Digits: "hangup" }), `b=${b4.id}&x=4`);
    await ready("REa4b", b4.id);
    expect(h.emails.at(-1)!.subject).toBe("New voicemail - Extension 3, Customer Care - (845) 555-0166");
    await saveSetting("ringName4", "");
    const b9 = await boxForKey("9");
    h.session.callSid = "CAfeedback";
    await call("vm-recorded", rec("REa9", { Digits: "hangup" }), `b=${b9.id}&x=9`);
    await ready("REa9", b9.id);
    expect(h.emails.at(-1)!.subject).toBe("New voicemail - Extension 9, Feedback and Comments - (845) 555-0166");
  });
});
