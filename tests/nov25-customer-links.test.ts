import { afterEach, describe, expect, it, vi } from "vitest";

/* No customer text ever contains vercel.app or dev=1 (Abraham, Nov 25, 2026 bug). In-memory database; Twilio is a stand-in. */
const h = vi.hoisted(() => ({ sent: [] as { body: string; mediaUrl?: string[] }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { body: string; mediaUrl?: string[] }) => (h.sent.push(p), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { db, schema } from "@/lib/db";
import { sendMessage, withSiteLinks } from "@/lib/sms";
import { payPageLink } from "@/lib/rental-terms";

const PHONE = "+18455550901";
const live = () => Object.assign(process.env, { AUTH_SECRET: "test-secret-links-0123456789", VERCEL_ENV: "production", VERCEL: "1", TWILIO_MESSAGING_SERVICE_SID: "MG1", PUBLIC_BASE_URL: "https://hupup.vercel.app" });
afterEach(() => {
  delete process.env.VERCEL_ENV;
  delete process.env.VERCEL;
  delete process.env.TWILIO_MESSAGING_SERVICE_SID;
  delete process.env.PUBLIC_BASE_URL;
});

describe("customer links", () => {
  it("live site: a vercel.app address in a text is sent as https://hupupattractions.com; dev=1 is never sent", async () => {
    live();
    const [c] = await db.insert(schema.customers).values({ phone: PHONE, name: "Test" }).returning();
    await db.insert(schema.smsConsents).values({ customerId: c.id, phone: PHONE, scope: "transactional", action: "opt_in", source: "phone", method: "keypad", wording: "x" });
    const ok = await sendMessage({ to: PHONE, body: "Pay here: https://hupup.vercel.app/pay/77?t=abc", kind: "transactional", event: "staff_reply" });
    expect(ok.sent).toBe(true);
    const blocked = await sendMessage({ to: PHONE, body: "Paid: https://hupup.vercel.app/paid?invoice=HU-1001&dev=1", kind: "transactional", event: "staff_reply" });
    expect(blocked).toMatchObject({ sent: false, blocked: "not_allowed" });
    for (const m of h.sent) {
      expect(m.body).not.toMatch(/vercel\.app|dev=1/);
      for (const u of m.mediaUrl ?? []) expect(u).not.toMatch(/vercel\.app|dev=1/);
    }
    expect(h.sent.at(-1)!.body).toContain("https://hupupattractions.com/pay/77?t=abc");
  });
  it("the payment link and the rewrite use the real site address on the live site", () => {
    live();
    expect(payPageLink(77)).toMatch(/^https:\/\/hupupattractions\.com\/pay\/1077\?t=/); // the order number people see (Batch 4 item 2)
    expect(withSiteLinks("see https://hupup-abc123-hup-up.vercel.app/terms")).toBe("see https://hupupattractions.com/terms");
  });
  it("a dev=1 link is refused even off Vercel", async () => {
    const r = await sendMessage({ to: PHONE, body: "https://example.com/paid?invoice=1&dev=1", kind: "transactional", event: "staff_reply" });
    expect(r.sent).toBe(false);
  });
});
