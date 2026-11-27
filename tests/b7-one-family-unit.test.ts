import { beforeAll, describe, expect, it, vi } from "vitest";

/* Hark's 2nd phone check, B7: a one-family house in the directory (no unit) never traps the caller in the unit step. */
const h = vi.hoisted(() => ({ session: { callSid: "CAb7", fromNumber: "+18455550193", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "carted", startedAt: new Date() } }));
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

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
const call = (action: string) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CAb7" }, callSid: "CAb7", from: "+18455550193" });
const redirect = (xml: string) => xml.match(/<Redirect method="POST">([^<]+)<\/Redirect>/)?.[1].replace(/^.*\/api\/voice\//, "").replace(/&amp;/g, "&");

beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  await db.insert(schema.directoryEntries).values([
    { lastName: "Klein", house: "12", street: "Forest Road", unit: null, town: "Monroe", zip: "10950" },
    { lastName: "Weiss", house: "7", street: "Garfield Road", unit: "101", town: "Monroe", zip: "10950" },
    { lastName: "Gross", house: "7", street: "Garfield Road", unit: "102", town: "Monroe", zip: "10950" },
  ]);
});

describe("unit step and the directory", () => {
  it("a one-family house (no unit in the directory): straight to the address check, no unit asked", async () => {
    h.session.data = { house: "12", street: "Forest Road", zip: "10950" };
    expect(redirect(await call("addr-unit-ask"))).toBe("addr-check");
  });
  it("a building where every entry has a unit: the unit is asked", async () => {
    h.session.data = { house: "7", street: "Garfield Road", zip: "10950" };
    expect(redirect(await call("addr-unit-ask"))).toBe("addr-unit");
  });
});
