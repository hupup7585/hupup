import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", async (orig) => ({ ...(await orig<typeof import("@/lib/notify")>()), sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { runWatchChunk } from "@/lib/phonepay-watch";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
  process.env.SOLA_API_KEY = "test";
});

describe("Hark's payment check, Nov 27, bug 1: try 2's watcher never acts on try 1's decline", () => {
  it("hangs up try 2's call to Sola within seconds, before the caller has keyed anything", async () => {
    // Try 1 (same call, same order, same amount) was declined at 10:00:20 ET (15:00:20Z). The caller heard the declined
    // line and went straight back: try 2 starts 30 seconds later.
    const try1Start = new Date("2026-11-18T15:00:00Z");
    const try2Start = new Date("2026-11-18T15:00:50Z");
    await db.insert(schema.phonepayAttempts).values({ callSid: "CAcaller", orderId: null, amountCents: 15000, startedAt: try1Start, endedAt: new Date("2026-11-18T15:00:40Z"), result: "declined", tryNumber: 1, callerPhone: "+18455550100" });
    const [try2] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAcaller", amountCents: 15000, startedAt: try2Start, tryNumber: 2, callerPhone: "+18455550100", payLegSid: "CAtry2leg" }).returning();
    // Sola's report: only try 1's decline exists (try 2 has not charged anything yet)
    const fetcher = (async (_u: string, init: { body: string }) => {
      const cmd = JSON.parse(init.body).xCommand;
      const rows = cmd === "Report:Declined" ? [{ xRefNum: "DECL1", xAmount: "150.00", xEnteredDate: "2026-11-18 10:00:20", xInvoice: "8455550100" }] : [];
      return new Response(JSON.stringify({ xResult: "S", xReportData: rows }));
    }) as unknown as typeof fetch;
    let t = try2Start.getTime() + 1000;
    const ended: string[] = [];
    await runWatchChunk(try2.id, 30_000, { fetcher, declineWaitMs: 6000, helperOn: false, now: () => new Date(t), sleep: async (ms) => void (t += ms), end: async (x) => void ended.push(x.payLegSid ?? "") });
    const secs = (t - try2Start.getTime()) / 1000;
    console.log("try 2 Sola leg hung up:", ended, "after", secs, "seconds");
    // Correct behaviour: try 2 is not hung up (it has no charge of its own yet)
    expect(ended).toEqual([]);
  });

  it("try 2's own decline (after try 2 started) is still caught and its Sola line hung up after the set wait", async () => {
    const t1 = new Date("2026-11-19T15:00:00Z");
    const t2 = new Date("2026-11-19T15:00:50Z");
    await db.insert(schema.phonepayAttempts).values({ callSid: "CAcaller2", amountCents: 15000, startedAt: t1, endedAt: new Date("2026-11-19T15:00:40Z"), result: "declined", tryNumber: 1, callerPhone: "+18455550101" });
    const [b] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAcaller2", amountCents: 15000, startedAt: t2, tryNumber: 2, callerPhone: "+18455550101", payLegSid: "CAleg2" }).returning();
    const fetcher = (async (_u: string, init: { body: string }) => {
      const rows = JSON.parse(init.body).xCommand === "Report:Declined"
        ? [
            { xRefNum: "D1", xAmount: "150.00", xEnteredDate: "2026-11-19 10:00:20", xInvoice: "8455550101" },
            { xRefNum: "D2", xAmount: "150.00", xEnteredDate: "2026-11-19 10:01:30", xInvoice: "8455550101" },
          ]
        : [];
      return new Response(JSON.stringify({ xResult: "S", xReportData: rows }));
    }) as unknown as typeof fetch;
    let t = t2.getTime() + 1000;
    const ended: string[] = [];
    await runWatchChunk(b.id, 60_000, { fetcher, declineWaitMs: 6000, helperOn: false, now: () => new Date(t), sleep: async (ms) => void (t += ms), end: async (x) => void ended.push(x.payLegSid ?? "") });
    expect(ended).toEqual(["CAleg2"]);
    const [row] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, b.id));
    expect(row.solaSeen).toBe("declined");
  });

  it("the same caller calling back within the minute: the earlier call's decline does not cut the new call's first try", async () => {
    const t1 = new Date("2026-11-20T15:00:00Z");
    await db.insert(schema.phonepayAttempts).values({ callSid: "CAfirstcall", amountCents: 9000, startedAt: t1, endedAt: new Date("2026-11-20T15:00:30Z"), result: "declined", tryNumber: 1, callerPhone: "+18455550102" });
    const [b] = await db.insert(schema.phonepayAttempts).values({ callSid: "CAsecondcall", amountCents: 9000, startedAt: new Date("2026-11-20T15:00:50Z"), tryNumber: 1, callerPhone: "+18455550102", payLegSid: "CAleg3" }).returning();
    const fetcher = (async (_u: string, init: { body: string }) =>
      new Response(JSON.stringify({ xResult: "S", xReportData: JSON.parse(init.body).xCommand === "Report:Declined" ? [{ xRefNum: "D9", xAmount: "90.00", xEnteredDate: "2026-11-20 10:00:20", xInvoice: "8455550102" }] : [] }))) as unknown as typeof fetch;
    let t = new Date("2026-11-20T15:00:51Z").getTime();
    const ended: string[] = [];
    await runWatchChunk(b.id, 20_000, { fetcher, declineWaitMs: 6000, helperOn: false, now: () => new Date(t), sleep: async (ms) => void (t += ms), end: async (x) => void ended.push(x.payLegSid ?? "") });
    expect(ended).toEqual([]);
  });
});
