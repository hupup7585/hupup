import { describe, expect, it, vi } from "vitest";

/* Hark's backend list 3 (Nov 26, 2026, card security): when PhonePay did not answer and the backup number is dialed for
   the same card try, the call recording is NOT resumed (card tones are never recorded); on other paths it resumes. */
const h = vi.hoisted(() => ({ resumed: 0, paused: 0, session: { callSid: "CArec", fromNumber: "+18455550919", orderId: null as number | null, data: { recording: true } as Record<string, unknown>, status: "in_progress", outcome: "browsing" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({ ensureSession: async () => h.session, getSession: async () => h.session, updateSession: async () => undefined }));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/call-recording", async (orig) => ({ ...(await orig<typeof import("@/lib/call-recording")>()), resumeRecording: async () => void h.resumed++, pauseRecording: async () => void h.paused++ }));
vi.mock("@/lib/sola-phonepay", async (orig) => ({ ...(await orig<typeof import("@/lib/sola-phonepay")>()), endMainPayLeg: async () => undefined, checkPhonePayTry: async () => ({ result: "paid" }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";

const call = (body: Record<string, string>, q: string) => handleVoice({ action: "phonepay-done", query: new URLSearchParams(q), body: { CallSid: "CArec", ...body }, callSid: "CArec", from: "+18455550919" });

describe("recording around the card payment", () => {
  it("no answer from PhonePay: the backup is dialed and the recording is not resumed", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-03-10", pickupDate: "2027-03-11", subtotalCents: 20000, totalCents: 20000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
    const [att] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CArec", tryNumber: 1, amountCents: 20000 }).returning();
    const xml = await call({ DialCallStatus: "no-answer" }, `o=${o.id}&a=${att.id}`);
    expect(xml).toContain("<Dial");
    expect(h.resumed).toBe(0);
    // the call came back from Sola normally: the recording resumes once
    await call({ DialCallStatus: "completed" }, `o=${o.id}&a=${att.id}&b=1`);
    expect(h.resumed).toBe(1);
  });
});
