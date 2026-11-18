import { describe, expect, it, vi } from "vitest";

/* Texting CATALOG gets the catalog (Abraham, Nov 18, 2026: "It's not sending catalog texts by request"). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { handleInboundSms } from "@/lib/sms-inbound";

describe("CATALOG by text", () => {
  it("a new number with no booking-text consent still gets the catalog reply (it asked for it), first text with the approved wording", async () => {
    await handleInboundSms({ From: "+18455550111", To: "+18454157585", Body: "Catalog", MessageSid: "SMcat1" });
    const out = (await db.select().from(schema.messages)).filter((m) => m.direction === "out" && m.event === "catalog_reply");
    expect(out.length).toBeGreaterThan(0);
    expect(out.every((m) => m.status !== "blocked")).toBe(true);
    expect(out[0].kind).toBe("system");
    expect(out[0].body).toBe("Hup Up Attractions: Here is our catalog! You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1.");
  });
  it("never after STOP", async () => {
    await db.insert(schema.customers).values({ phone: "+18455550112", smsOptOut: true });
    await handleInboundSms({ From: "+18455550112", To: "+18454157585", Body: "CATALOG", MessageSid: "SMcat2" });
    const out = (await db.select().from(schema.messages)).filter((m) => m.direction === "out" && m.toNumber === "+18455550112" && m.status !== "blocked");
    expect(out).toHaveLength(0);
  });
});
