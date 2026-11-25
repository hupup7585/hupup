import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Every step ending "If that is correct, press 1. To try again, press 2." (Abraham, Nov 24, 2026; boxes 37, 38, 44, 48):
 * 1 confirms and continues, 2 retries that entry, pound never continues.
 */
const h = vi.hoisted(() => ({
  session: { callSid: "CAconf", fromNumber: "+18455550199", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing", startedAt: new Date() },
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
vi.mock("@/lib/delivery-areas", async (orig) => ({ ...(await orig<typeof import("@/lib/delivery-areas")>()), deliveryQuote: async () => ({ ok: true, zone: "Local", feeCents: 1000, kind: "local" }) }));

import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, q = "") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: "CAconf", ...body }, callSid: "CAconf", from: "+18455550199" });
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1]);
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const NOT_VALID = "Sorry, that is not a valid selection.";

beforeEach(() => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  h.session.data = { name: "Sara Klein", heard: "Sara Klein", house: "12", street: "Forest Road", zip: "10950", town: "Monroe", address: "12 Forest Road, Monroe, NY 10950", phone: "+18455550199" };
});

// step, query, where 1 goes, where 2 goes (the retry)
const steps: [string, string, RegExp, RegExp][] = [
  ["confirm", "f=name", /.+/, /^ask\?f=name$/],
  ["date-confirm", "d=2026-12-07", /.+/, /^date/],
  ["addr-street-rb-choice", "m=v", /^addr-unit-ask$/, /^ask\?f=street$/],
  ["addr-readback-choice", "", /^addr-price$/, /^addr-house$/],
  ["phone-confirm", "", /^sms-consent$/, /^phone-enter$/],
];

describe("confirm steps: 1 continues, 2 retries, pound never continues", () => {
  for (const [step, q, one, two] of steps) {
    it(step, async () => {
      const pound = await call(step, { Digits: "#" }, q);
      expect(said(pound)[0], step).toBe(NOT_VALID);
      expect(redirect(pound) ?? "", step).not.toMatch(one.source === ".+" ? /^(cart|addr|phone|finalize|qty|cats)/ : one);
      const retry = await call(step, { Digits: "2" }, q);
      expect(redirect(retry), step).toMatch(two);
      if (step === "confirm") h.session.data.heard = "Sara Klein";
      const yes = await call(step, { Digits: "1" }, q);
      expect(said(yes), step).not.toContain(NOT_VALID);
      expect(redirect(yes) ?? yes, step).toMatch(one);
    });
  }
});
