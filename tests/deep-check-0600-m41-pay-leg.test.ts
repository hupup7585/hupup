import { describe, expect, it, vi } from "vitest";

/* Deep check 0600 M41: our separate call to Sola (with music) never saves a hotline call of its own. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";

describe("M41: pay-leg-wait is a leg, not a caller", () => {
  it("no call session is saved for the call to Sola, while it waits and when it joins", async () => {
    Object.assign(process.env, { PUBLIC_BASE_URL: "https://hupup.example" });
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "PHONE", eventDate: "2026-11-20", pickupDate: "2026-11-20", subtotalCents: 80000, totalCents: 80000 }).returning();
    const [a] = await db.insert(schema.phonepayAttempts).values({ orderId: o.id, callSid: "CAcaller41", amountCents: 80000, holdStartedAt: new Date() }).returning();
    const run = (q: string) => handleVoice({ action: "pay-leg-wait", query: new URLSearchParams(q), body: { CallSid: "CAsola41" }, callSid: "CAsola41", from: "+18337777777" });
    expect(await run(`a=${a.id}`)).toContain("<Pause");
    expect(await run(`a=${a.id}&n=60`)).toContain("<Queue");
    expect(await db.select().from(schema.callSessions).where(eq(schema.callSessions.callSid, "CAsola41"))).toEqual([]);
  });
});
