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
    expect(x).toMatch(/<Enqueue [^>]*waitUrl="https:\/\/hupup\.example\/api\/voice\/music\?place=pay"[^>]*>pay-CAcaller<\/Enqueue>/);
    expect(x).not.toContain("4321"); // the merchant code is never in the caller's call
    expect(h.created[0]).toMatchObject({ to: "+18334343354", from: "+18454157585" });
    const a = (await db.select().from(schema.phonepayAttempts)).at(-1)!;
    expect(a.payLegSid).toBe("CAsola");
    // the call to Sola: the key tones, then it joins the caller's queue
    const leg = await call("pay-leg", {}, `a=${a.id}`, "CAsola");
    expect(leg).toMatch(/<Play digits="w+4321#w+80000#w+1"\/>/);
    expect(leg).toContain("<Queue>pay-CAcaller</Queue>");
    // the music the caller hears comes piece by piece
    expect(await call("music", {}, "place=pay")).toContain(`/api/music/music/${t.id}/0.wav`);
    // Sola never answered: the waiting caller is moved on (backup number)
    await call("pay-leg-status", { CallStatus: "no-answer" }, `a=${a.id}`, "CAsola");
    expect(h.updated[0]).toMatchObject({ sid: "CAcaller" });
    expect(String(h.updated[0].body.url)).toContain(`phonepay-done?o=${orderId}&a=${a.id}&nr=1`);
  });
});
