import { describe, expect, it, vi } from "vitest";

/* Deep check Nov 27, 9:00 AM, P11 (M27 completed): the website "text me the catalog" box checked STOP only on the first
   customer record with the number; a STOP on a duplicate record let it save an opt-in record (the text itself was
   blocked later). Now a STOP on any record with the number: nothing saved, nothing sent. */
const h = vi.hoisted(() => ({ sent: [] as string[], ip: "203.0.113.9" }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": `${h.ip}, 10.0.0.1`, "user-agent": "UA", referer: "https://hupupattractions.com/" }),
}));
vi.mock("@/lib/catalog-send", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalog-send")>()),
  sendCatalogEmail: async (to: string) => (h.sent.push(to), { sent: true }),
  recordCatalogRequest: async () => null,
  replyToCatalogText: async (to: string) => (h.sent.push(`text:${to}`), { replied: true, reason: null }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requestCatalogAction, textCatalogAction } from "@/app/catalog-actions";
import { CATALOG_FORM_DRAFT, MAX_CATALOG_REQUESTS_PER_IP_PER_DAY } from "@/lib/catalog-request";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("deep check 09:00 P11: STOP on any record with the number", () => {
  it("first record without STOP, a duplicate record with STOP: no consent record, no text", async () => {
    await db.insert(schema.customers).values({ name: "First", phone: "+18455550411", smsOptOut: false });
    await db.insert(schema.customers).values({ name: "Duplicate", phone: "+18455550411", smsOptOut: true });
    const r = await textCatalogAction(null, form({ phone: "8455550411", consent: "yes" }));
    expect(r.ok).toBe(false);
    expect(h.sent).toEqual([]);
    const rows = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455550411"));
    expect(rows).toEqual([]);
  });
  it("no STOP on any record: sent as before", async () => {
    await db.insert(schema.customers).values({ name: "Fine", phone: "+18455550412", smsOptOut: false });
    expect((await textCatalogAction(null, form({ phone: "8455550412", consent: "yes" }))).ok).toBe(true);
    expect(h.sent).toEqual(["text:+18455550412"]);
  });
});
