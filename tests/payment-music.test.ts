import { beforeAll, describe, expect, it, vi } from "vitest";

/* Music while connecting to the payment line (Abraham, Nov 17, 2026, items 4 and 10). Twilio is a stand-in. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAcaller", fromNumber: "+18457990925", orderId: null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
  created: [] as Record<string, unknown>[],
  updated: [] as { sid: string; body: Record<string, unknown> }[],
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_sid: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, patch, patch.data ? { data: { ...h.session.data, ...patch.data } } : {}),
}));
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () =>
    Object.assign((sid: string) => ({ update: async (body: Record<string, unknown>) => h.updated.push({ sid, body }) }), {
      calls: Object.assign((sid: string) => ({ update: async (body: Record<string, unknown>) => h.updated.push({ sid, body }), fetch: async () => ({ status: "completed" }) }), {
        create: async (o: Record<string, unknown>) => (h.created.push(o), { sid: "CAsola" }),
      }),
    }),
}));

import { db, schema } from "@/lib/db";
import { saveSetting } from "@/lib/settings";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string, body: Record<string, string> = {}, q = "", sid = "CAcaller") =>
  handleVoice({ action, query: new URLSearchParams(q), body: { CallSid: sid, ...body }, callSid: sid, from: "+18457990925" });
let orderId = 0;
const flush = () => new Promise((r) => setTimeout(r, 30));

beforeAll(async () => {
  Object.assign(process.env, { PUBLIC_BASE_URL: "https://hupup.example", SOLA_PHONEPAY_PIN: "4321", TWILIO_PHONE_NUMBER: "+18454157585", SOLA_API_KEY: "k" });
  const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-11-20", pickupDate: "2026-11-20", subtotalCents: 80000, totalCents: 80000 }).returning();
  orderId = o.id;
});

describe("payment line with music", () => {
  it("no songs chosen: the direct way, as before", async () => {
    const x = await call("phonepay-go", {}, `o=${orderId}&c=1`);
    expect(x).toContain("<Dial");
    expect(h.created).toHaveLength(0);
  });
  it("songs chosen: the caller waits with the music; a separate call enters the code and amount, then joins the caller", async () => {
    const [t] = await db.insert(schema.musicTracks).values({ name: "Song", pieces: 2, pieceSeconds: 8, durationSec: 16, complete: true }).returning();
    await saveSetting("musicPayConnect", String(t.id));
    const x = await call("phonepay-go", {}, `o=${orderId}&c=1`);
    await flush(); // a retry starts the call to Sola during the hold line (Nov 25, 2026)
    expect(x).toMatch(/<Enqueue [^>]*waitUrl="https:\/\/hupup\.example\/api\/voice\/music\?place=pay&amp;a=\d+"[^>]*>pay-CAcaller<\/Enqueue>/);
    expect(x).not.toContain("4321"); // the merchant code is never in the caller's call
    expect(h.created[0]).toMatchObject({ to: "+18334343354", from: "+18454157585" });
    const a = (await db.select().from(schema.phonepayAttempts)).at(-1)!;
    expect(a.payLegSid).toBe("CAsola");
    // the call to Sola: the key tones, then it joins the caller's queue
    const leg = await call("pay-leg", {}, `a=${a.id}`, "CAsola");
    expect(leg).toMatch(/<Play digits="w+4321#w+80000#w+1"\/>/);
    const join = await call("pay-leg-wait", {}, `a=${a.id}`, "CAsola"); // no hold line in the queue: joins right away
    expect(join).toMatch(/<Queue url="https:\/\/hupup\.example\/api\/voice\/pay-leg-joined\?a=\d+" method="POST">pay-CAcaller<\/Queue>/);
    // the music the caller hears comes piece by piece
    expect(await call("music", {}, "place=pay")).toContain(`/api/music/music/${t.id}/0.wav`);
    // Sola never answered: one redial first (Nov 23, 2026), then the waiting caller is moved on (backup number)
    await call("pay-leg-status", { CallStatus: "no-answer" }, `a=${a.id}`, "CAsola");
    expect(h.created).toHaveLength(2);
    expect(String(h.created[1].statusCallback)).toContain(`pay-leg-status?a=${a.id}&r=1`);
    expect(h.updated).toHaveLength(0);
    await call("pay-leg-status", { CallStatus: "no-answer" }, `a=${a.id}&r=1`, "CAsola");
    expect(h.updated[0]).toMatchObject({ sid: "CAcaller" });
    expect(String(h.updated[0].body.url)).toContain(`phonepay-done?o=${orderId}&a=${a.id}&nr=1`);
  });
  it("Nov 23, 2026 bug: the call to Sola ends after 7 seconds without joining: redial once, then the try-again menu right away", async () => {
    h.updated.length = 0;
    const x = await call("phonepay-go", {}, `o=${orderId}&c=1`);
    await flush();
    expect(x).toContain("<Enqueue");
    const a = (await db.select().from(schema.phonepayAttempts)).at(-1)!;
    const before = h.created.length;
    await call("pay-leg-status", { CallStatus: "completed", CallDuration: "7" }, `a=${a.id}`, "CAsola");
    expect(h.created.length).toBe(before + 1); // the redial
    expect(h.updated).toHaveLength(0);
    await call("pay-leg-status", { CallStatus: "completed", CallDuration: "7" }, `a=${a.id}&r=1`, "CAsola");
    expect(h.updated[0]).toMatchObject({ sid: "CAcaller" });
    expect(String(h.updated[0].body.url)).toContain(`phonepay-done?o=${orderId}&a=${a.id}`);
    expect(String(h.updated[0].body.url)).not.toContain("nr=1");
  });
  it("joined: nothing moves the caller when the call to Sola ends", async () => {
    h.updated.length = 0;
    await call("phonepay-go", {}, `o=${orderId}&c=1`);
    await flush();
    const a = (await db.select().from(schema.phonepayAttempts)).at(-1)!;
    await call("pay-leg-joined", {}, `a=${a.id}`, "CAcaller");
    const before = h.created.length;
    await call("pay-leg-status", { CallStatus: "completed", CallDuration: "95" }, `a=${a.id}`, "CAsola");
    expect(h.created.length).toBe(before);
    expect(h.updated).toHaveLength(0);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).not.toMatch(/endPayLeg\(/); // main account only
  });
});

describe("connect timing (Abraham, Nov 25, 2026): Sola is called before the hold line; the line is never cut", () => {
  const HOLD = "We will now connect you to our secure payment line. All card information is processed securely and directly by our provider, to ensure your card details remain private and protected. This may take a few moments. Please stay on the line while we connect you. Once your payment has been processed, please remain on the line to receive your booking confirmation.";
  const said = (xml: string) => [...xml.matchAll(/<Say [^>]*>([^<]+)<\/Say>/g)].map((m) => m[1]);
  let o2 = 0;
  beforeAll(async () => {
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-12-03", pickupDate: "2026-12-04", subtotalCents: 50000, totalCents: 50000 }).returning();
    o2 = o.id;
  });
  it("key 0 at box 140: nothing is dialed (the payment link)", async () => {
    const before = h.created.length;
    const x = await call("phonepay-option", { Digits: "0" }, `o=${o2}`);
    expect(x).toContain(`paylink?o=${o2}`);
    expect(h.created.length).toBe(before);
    expect(x).not.toContain("<Dial");
  });
  it("first try, no key: the call to Sola starts before the hold line, which plays first in the pay queue", async () => {
    const before = h.created.length;
    const x = await call("phonepay-go", {}, `o=${o2}&c=1`);
    expect(h.created.length).toBe(before + 1); // Sola is already being called when the caller's reply goes out
    expect(said(x)).toEqual([]); // the hold line is not in this reply: it plays inside the queue
    expect(x).toContain("<Enqueue");
    const a = (await db.select().from(schema.phonepayAttempts)).at(-1)!;
    const first = await call("music", {}, `place=pay&a=${a.id}`);
    expect(said(first)).toEqual([HOLD]);
    expect(first).not.toContain("/api/music/");
  });
  it("the hold line is never cut: Sola waits (1-second pauses) until it ends, then joins; the music seconds are logged", async () => {
    const a = (await db.select().from(schema.phonepayAttempts)).at(-1)!;
    const waiting = await call("pay-leg-wait", {}, `a=${a.id}`, "CAsola");
    expect(waiting).toContain('<Pause length="1"/>');
    expect(waiting).not.toContain("<Queue");
    expect(waiting).toContain(`pay-leg-wait?a=${a.id}&amp;n=1`);
    // deep check 06:00 M41: the call to Sola is never saved as a hotline call
    const { eq: eq41 } = await import("drizzle-orm");
    expect(await db.select().from(schema.callEvents).where(eq41(schema.callEvents.callSid, "CAsola"))).toHaveLength(0);
    // the line finished: the next music request marks it done and plays music
    const next = await call("music", {}, `place=pay&a=${a.id}`);
    expect(next).toContain("/api/music/");
    const ready = await call("pay-leg-wait", {}, `a=${a.id}&n=1`, "CAsola");
    expect(ready).toContain("<Queue");
    await call("pay-leg-joined", {}, `a=${a.id}`, "CAcaller");
    const [after] = await db.select().from(schema.phonepayAttempts).where((await import("drizzle-orm")).eq(schema.phonepayAttempts.id, a.id));
    expect(after.holdDoneAt).toBeTruthy();
    expect(after.bridgedAt).toBeTruthy();
    const steps = await db.select().from(schema.callEvents);
    const logged = steps.find((e) => /seconds of music after the hold line/.test(e.label));
    expect(logged?.label).toMatch(/^Payment line joined: \d+ seconds of music after the hold line/);
  });
  it("a retry: the caller is queued at once (the hold line plays) while the call to Sola starts after the 3-second wait", async () => {
    const before = h.created.length;
    const x = await call("phonepay-go", {}, `o=${o2}`);
    expect(x).toContain("<Enqueue");
    expect(said(x)).toEqual([]);
    expect(x).not.toContain("box 140");
    await flush();
    expect(h.created.length).toBe(before + 1);
    const a = (await db.select().from(schema.phonepayAttempts)).at(-1)!;
    expect(said(await call("music", {}, `place=pay&a=${a.id}`))).toEqual([HOLD]);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/ivr/flow.ts", "utf8")).toContain("waitMs: process.env.VITEST ? 0 : 3000");
  });
});


describe("deep check 06:00 M41", () => {
  it("the call to Sola waiting to join (pay-leg-wait) is never logged as a hotline caller's call", async () => {
    const { readFileSync } = await import("node:fs");
    const line = readFileSync("src/lib/ivr/flow.ts", "utf8").split("\n").find((l) => l.startsWith("const STAFF_LEG_ACTIONS"))!;
    for (const a of ["pay-leg", "pay-leg-wait", "pay-leg-status"]) expect(line).toContain(`"${a}"`);
  });
});
