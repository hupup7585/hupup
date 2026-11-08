import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Text-consent boxes on the pay page and staff New booking (Abraham, approved). In-memory database; nothing is sent. */
const h = vi.hoisted(() => ({ sent: [] as { to: string; body: string; event?: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/sms", async (orig) => ({
  ...(await orig<typeof import("@/lib/sms")>()),
  sendMessage: async (m: { to: string; body: string; event?: string }) => (h.sent.push(m), { sent: true }),
  cancelQueuedPromotions: async () => {},
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { recordBookingConsents } from "@/lib/booking-consent";
import { MARKETING_CONFIRMATION_SMS, TRANSACTIONAL_CONFIRMATION_SMS } from "@/lib/sms-consent";
import { WEB_CONSENT_MARKETING, WEB_CONSENT_TRANSACTIONAL, WEB_CONSENT_VERSION } from "@/lib/sms-consent-copy";

const rows = async (phone: string) => db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, phone));
beforeEach(() => {
  h.sent.length = 0;
});

describe("text-consent boxes on bookings", () => {
  it("pay page: each checked box is saved with the exact approved wording, version, time, IP and page, then confirmed by text", async () => {
    const r = await recordBookingConsents({ phone: "(845) 777-1001", transactional: true, marketing: true, source: "web", orderId: 5, ip: "1.2.3.4", userAgent: "UA", pageUrl: "https://hupup.example/pay/5" });
    expect(r).toEqual({ saved: ["transactional", "marketing"], stopped: false });
    const saved = await rows("+18457771001");
    expect(saved.find((x) => x.scope === "transactional")).toMatchObject({ action: "opt_in", source: "web", method: "checkbox", wording: WEB_CONSENT_TRANSACTIONAL, wordingVersion: WEB_CONSENT_VERSION, ip: "1.2.3.4", orderId: 5, pageUrl: "https://hupup.example/pay/5" });
    expect(saved.find((x) => x.scope === "marketing")).toMatchObject({ wording: WEB_CONSENT_MARKETING, source: "web" });
    expect(saved[0].createdAt).toBeInstanceOf(Date);
    expect(h.sent.map((m) => m.body)).toEqual([TRANSACTIONAL_CONFIRMATION_SMS, MARKETING_CONFIRMATION_SMS]);
  });

  it("promotional is optional: order texts alone, or nothing at all, never blocks booking or paying", async () => {
    expect((await recordBookingConsents({ phone: "+18457771002", transactional: true, marketing: false, source: "web" })).saved).toEqual(["transactional"]);
    expect((await rows("+18457771002")).map((x) => x.scope)).toEqual(["transactional"]);
    expect(await recordBookingConsents({ phone: "+18457771003", transactional: false, marketing: false, source: "web" })).toEqual({ saved: [], stopped: false });
    expect(await rows("+18457771003")).toEqual([]);
  });

  it("staff New booking: saved with the staff member who checked it after reading the wording", async () => {
    await recordBookingConsents({ phone: "+18457771004", transactional: false, marketing: true, source: "pos", orderId: 9, userId: 3, ip: "10.0.0.1" });
    const [x] = await rows("+18457771004");
    expect(x).toMatchObject({ scope: "marketing", source: "pos", method: "staff", userId: 3, orderId: 9, disclosureRead: true, wording: WEB_CONSENT_MARKETING });
  });

  it("a number that replied STOP isn't changed (only START + YES can re-enroll)", async () => {
    await db.insert(schema.customers).values({ phone: "+18457771005", smsOptOut: true });
    expect(await recordBookingConsents({ phone: "+18457771005", transactional: true, marketing: true, source: "web" })).toEqual({ saved: [], stopped: true });
    expect(await rows("+18457771005")).toEqual([]);
    expect(h.sent).toEqual([]);
  });

  it("both boxes start unchecked, are separate, link to the SMS Terms and Privacy Policy, and aren't required", () => {
    const boxes = readFileSync("src/components/TextConsentBoxes.tsx", "utf8");
    expect(boxes).not.toMatch(/<input[^>]*(defaultChecked|required)/);
    expect(boxes).toContain('href="/sms-terms"');
    expect(boxes).toContain('href="/privacy"');
    const pay = readFileSync("src/app/pay/[orderId]/PayForm.tsx", "utf8");
    expect(pay).toContain("useState({ transactional: false, marketing: false })");
    expect(pay).toContain("disabled={!agreed || pending}"); // only the Terms box gates payment
    const pos = readFileSync("src/app/admin/(app)/pos/PosForm.tsx", "utf8");
    expect(pos).toContain("useState({ transactional: false, marketing: false })");
    expect(readFileSync("src/app/pay/[orderId]/actions.ts", "utf8")).toContain('source: "web"');
    expect(readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8")).toContain('source: "pos"');
  });
});
