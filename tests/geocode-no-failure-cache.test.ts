import { describe, expect, it, vi } from "vitest";

/* Hark's 2nd phone check B8 + Abraham, Nov 26, 10:43 PM: a timed-out or failed map lookup is never saved as "address
 * not found"; the two services are asked at the same time with a short limit. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
import { db, schema } from "@/lib/db";
import { geocode } from "@/lib/delivery-areas";

describe("map lookup", () => {
  it("both services fail: null, and nothing is saved, so the next try asks again", async () => {
    const failing = (async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
    const t0 = Date.now();
    expect(await geocode("12 Nowhere Road, Monroe, NY 10950", failing)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(14000); // one try after the other, about 4.5 seconds each at most
    expect(await db.select().from(schema.geocodeCache)).toEqual([]);
  });
  it("both services answer 'no match': still never saved as 'not found' (Abraham, Nov 27, 2026), so it is asked again next time", async () => {
    const none = (async (url: string) => new Response(JSON.stringify(String(url).includes("census") ? { result: { addressMatches: [] } } : []))) as unknown as typeof fetch;
    expect(await geocode("99 Nowhere Lane, Monroe, NY 10950", none)).toBeNull();
    expect(await db.select().from(schema.geocodeCache)).toEqual([]);
  });
  it("one service answers with a place: found and saved", async () => {
    const census = (async (url: string) => new Response(JSON.stringify(String(url).includes("census") ? { result: { addressMatches: [{ coordinates: { x: -74.18, y: 41.33 } }] } } : []))) as unknown as typeof fetch;
    expect(await geocode("1 Forest Road, Monroe, NY 10950", census)).toMatchObject({ source: "census" });
  });
});
