import { beforeAll, describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P13 (simulated call): after the last card try, when that try could not be confirmed in
   Sola (box 147: unclear, or Sola could not be checked), the Owner was emailed "it did not go through" although the
   charge may have gone through. Now the Owner is told to check Sola first. A plain decline keeps the old email. The
   caller's line (phonepay_failed, approved) is the same in both cases. */
const h = vi.hoisted(() => ({ emails: [] as { subject: string; text: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async (_to: string, subject: string, text: string) => (h.emails.push({ subject, text }), { sent: true }) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { getSettings } from "@/lib/settings";
import { phonePayLimits } from "@/lib/phonepay-watch";

const SID = "CAp13";
const call = (q: string) => handleVoice({ action: "phonepay-retry", query: new URLSearchParams(q), body: { CallSid: SID }, callSid: SID, from: "+18455550147" });
let o = 0;
let max = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.ADMIN_EMAIL = "owner@example.com";
  const [row] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2027-06-08", pickupDate: "2027-06-09", subtotalCents: 30000, totalCents: 30000, holdExpiresAt: new Date(Date.now() + 600_000) }).returning();
  o = row.id;
  max = phonePayLimits(await getSettings()).triesPerCall;
});

describe("deep check 09:00 P13: the Owner email after the last try", () => {
  it("last try could not be confirmed: 'check Sola first', never 'it did not go through'", async () => {
    h.emails.length = 0;
    const xml = await call(`o=${o}&n=${max}&u=1`);
    expect(xml).toContain("<Hangup/>");
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].subject).toContain("could not be confirmed");
    expect(h.emails[0].text).toContain("Please check Sola");
    expect(h.emails[0].text).not.toContain("did not go through");
  });
  it("last try declined: the same email as before", async () => {
    h.emails.length = 0;
    const xml = await call(`o=${o}&n=${max}`);
    expect(xml).toContain("<Hangup/>");
    expect(h.emails[0].subject).toContain(`failed ${max} times`);
    expect(h.emails[0].text).toContain("did not go through");
  });
});
