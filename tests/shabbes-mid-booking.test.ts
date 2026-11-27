import { afterEach, describe, expect, it, vi } from "vitest";

/* Shabbes or Yom Tov starts in the middle of a booking (Abraham's priority list, Nov 26, 2026): after candle lighting
   no order is finalized and no payment is taken; the caller gets the closed greeting and the general voicemail. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));

import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string, body: Record<string, string> = {}, q = "") => handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAshab", ...body }, callSid: "CAshab", from: "+18455550511" });

const FRIDAY_NIGHT = "2027-01-15T23:30:00Z"; // Friday, Jan 15, 2027, 6:30 PM in New York: after candle lighting
afterEach(() => void delete process.env.HUP_CALENDAR_NOW);

describe("Shabbes during a booking", () => {
  it("checkout, card payment, the payment link menu and the payment step are all stopped with the closed greeting", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    process.env.HUP_CALENDAR_NOW = FRIDAY_NIGHT;
    for (const [action, q] of [["finalize", ""], ["pay-keypad", "o=7"], ["paylink-choice", "o=7"], ["phonepay-go", "o=999999"]] as const) {
      const xml = await call(action, { Digits: "1" }, q);
      expect(xml, action).toContain("<Record");
      expect(xml, action).not.toContain("pay-");
    }
  });
  it("on a weekday the checkout goes on as before", async () => {
    process.env.HUP_CALENDAR_NOW = "2027-01-13T17:00:00Z";
    expect(await call("finalize")).not.toContain("<Record");
  });
});
