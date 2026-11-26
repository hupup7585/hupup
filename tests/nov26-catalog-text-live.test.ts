import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/* Key 8 catalog by text on the live site (Abraham, Nov 26, 2026): Twilio approved our texting (A2P 10DLC) on Nov 15,
 * 2026, so the "not yet" gate is off. Choosing text sends the catalog in its two messages, then "Done!". */
const h = vi.hoisted(() => ({
  session: { callSid: "CAcatlive", fromNumber: "+18455550102", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  sent: [] as { to: string; body: string; media?: string[] }[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: { data?: Record<string, unknown> } & Record<string, unknown>) => {
    const { data, ...rest } = patch;
    Object.assign(h.session, rest);
    if (data) h.session.data = { ...h.session.data, ...data };
  },
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/notify", () => ({ sendSms: async () => ({ sent: true }), sendEmail: async () => ({ sent: true }) }));
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string; body: string; mediaUrl?: string[] }) => (h.sent.push({ to: p.to, body: p.body, media: p.mediaUrl }), { sid: `SM${h.sent.length}`, status: "queued" }) } }),
}));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { saveSetting } from "@/lib/settings";

const FROM = "+18455550102";
const call = (action: string, body: Record<string, string> = {}, query = "") => handleVoice({ action, query: new URLSearchParams(query), body: { CallSid: "CAcatlive", ...body }, callSid: "CAcatlive", from: FROM });
const plain = (x: string) => x.replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => plain(m[1]));
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");
const env = { ...process.env };

beforeAll(async () => {
  // the live site, as configured in Vercel (names only; test values)
  Object.assign(process.env, { PUBLIC_BASE_URL: "https://hupup.example", VERCEL_ENV: "production", TWILIO_ACCOUNT_SID: "ACtest", TWILIO_AUTH_TOKEN: "test", TWILIO_MESSAGING_SERVICE_SID: "MGtest", TWILIO_PHONE_NUMBER: "+18454157585" });
  await saveSetting("catalogTextPicture1", "/api/catalog-photo/catalog/page1.jpg");
});
afterAll(() => {
  for (const k of ["VERCEL_ENV", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_PHONE_NUMBER"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

describe("key 8, text, on the live site", () => {
  it("1 = text: the text steps, never 'Sorry, we cannot send it by text just yet'", async () => {
    const xml = plain(await call("catalog-choice", { Digits: "1" }));
    expect(redirect(xml)).toBe("tx-which?p=cat");
    expect(xml).not.toContain(PROMPTS.catalog_text_not_yet.text);
  });
  it("this number: the catalog goes out in its two messages (the words, then the picture), then catalog_texted and goodbye", async () => {
    const done = await call("tx-which-choice", { Digits: "1" }, "p=cat");
    const out = h.sent.filter((m) => m.to === FROM);
    expect(out).toHaveLength(2);
    expect(out[0].body).toMatch(/^Hup Up Attractions: Here is our catalog!/);
    expect(out[0].media ?? []).toEqual([]);
    expect(out[1].media).toEqual(["https://hupup.example/api/catalog-photo/catalog/page1.jpg"]);
    expect(said(done)).toEqual([PROMPTS.catalog_texted.text]);
    expect(done).not.toContain("just yet");
    expect(done).toContain("<Hangup/>");
    const rows = await db.select().from(schema.messages);
    expect(rows.filter((m) => m.direction === "out" && m.contactPhone === FROM).every((m) => m.status === "queued")).toBe(true);
  });
  it("consent and STOP unchanged: a number that replied STOP gets no catalog text, and hears the email offer", async () => {
    h.sent.length = 0;
    const stopped = "+18455550103";
    await db.insert(schema.customers).values({ phone: stopped, smsOptOut: true });
    const done = await handleVoice({ action: "tx-which-choice", query: new URLSearchParams("p=cat"), body: { CallSid: "CAcatlive", Digits: "1" }, callSid: "CAcatlive", from: stopped });
    expect(h.sent.filter((m) => m.to === stopped)).toHaveLength(0);
    expect(redirect(done)).toBe("catalog-email?p=cat");
  });
});
