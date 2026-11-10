import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Owner alerts (Abraham, Nov 9, 2026): missed calls and incoming texts, by email until Twilio texting is approved. */
const h = vi.hoisted(() => ({
  emails: [] as { to: string; subject: string; text: string }[],
  sms: [] as { to: string; body: string }[],
  session: { callSid: "CAmiss", fromNumber: "+18455550701", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
  sendSms: async (to: string, body: string) => (h.sms.push({ to, body }), { sent: true }),
}));
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));
vi.mock("@/lib/sms", async (orig) => ({ ...(await orig<typeof import("@/lib/sms")>()), sendMessage: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { handleCallStatus } from "@/lib/ivr/flow";
import { mainBox } from "@/lib/voicemail";
import { emailIncomingText, missedKey } from "@/lib/owner-alerts";
import { saveSetting } from "@/lib/settings";

const step = (callSid: string, s: string) => db.insert(schema.callEvents).values({ callSid, step: s, kind: "step", label: s });

beforeAll(async () => {
  process.env.ADMIN_PHONE = "+18457777585";
  process.env.ADMIN_EMAIL = "hupupattractions@gmail.com";
  process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
  await mainBox();
});

describe("missed-call alert", () => {
  it("reached voicemail and hung up without a message: one email with number, key and time; never twice", async () => {
    h.session = { ...h.session, callSid: "CAm1", data: { menuKeys: ["0"], missed: "no_answer" }, outcome: "voicemail" };
    await step("CAm1", "voicemail");
    await handleCallStatus("CAm1", "completed");
    await handleCallStatus("CAm1", "completed"); // Twilio retry
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].to).toBe("hupupattractions@gmail.com");
    expect(h.emails[0].subject).toMatch(/^Missed call from \(845\) 555-0701, [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, 20\d\d, \d{1,2}:\d\d [AP]M$/);
    expect(h.emails[0].text).toContain("Key: Key 0 (no one answered)");
    expect(h.emails[0].text).toContain("the caller reached voicemail and hung up without leaving a message");
    expect(h.sms).toHaveLength(0); // texts wait for Twilio approval
  });
  it("hung up while it was ringing", async () => {
    h.emails.length = 0;
    h.session = { ...h.session, callSid: "CAm2", data: { menuKeys: ["4"] }, outcome: "forwarded" };
    await step("CAm2", "ring");
    await handleCallStatus("CAm2", "completed");
    expect(h.emails[0].text).toContain("the caller hung up while the phone was ringing");
    expect(h.emails[0].text).toContain("Key: Key 4");
  });
  it("a voicemail left on the call replaces the missed-call alert; turned off in Admin means none", async () => {
    h.emails.length = 0;
    h.session = { ...h.session, callSid: "CAm3", data: { menuKeys: ["9"], leftMessage: true }, outcome: "voicemail" };
    await step("CAm3", "voicemail");
    await handleCallStatus("CAm3", "completed");
    expect(h.emails).toHaveLength(0);
    await saveSetting("missedCallAlerts", false);
    h.session = { ...h.session, callSid: "CAm4", data: { menuKeys: ["9"] }, outcome: "voicemail" };
    await step("CAm4", "voicemail");
    await handleCallStatus("CAm4", "completed");
    expect(h.emails).toHaveLength(0);
    await saveSetting("missedCallAlerts", true);
  });
  it("key wording", () => {
    expect(missedKey({ menuKeys: ["1", "6"], missed: "closed" })).toBe("Key 6 (office closed)");
    expect(missedKey({})).toBe("before choosing a key");
  });
});

describe("incoming text email", () => {
  it("emails the sender, the full text and a link for photos", async () => {
    h.emails.length = 0;
    await emailIncomingText({ from: "+18455550702", body: "Is the castle free Sunday?", mediaUrls: ["https://api.twilio.com/x/Media/ME1"], at: new Date("2026-11-09T20:15:00Z") });
    expect(h.emails[0].subject).toBe("Text from (845) 555-0702, Mon, Nov 9, 2026, 3:15 PM");
    expect(h.emails[0].text).toContain("Is the castle free Sunday?");
    expect(h.emails[0].text).toContain("Photos (1): open them in Admin, Messages:");
    expect(readFileSync("src/lib/sms-inbound.ts", "utf8")).toContain("await emailIncomingText(");
    expect(readFileSync("src/app/admin/(app)/voicemail/page.tsx", "utf8")).toContain('name="missedCallAlerts"');
  });
});
