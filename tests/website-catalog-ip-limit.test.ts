import { describe, expect, it, vi } from "vitest";

/* Website catalog boxes: at most 10 catalog sends (email and text together) per internet address per day. */
const h = vi.hoisted(() => ({ sent: [] as string[], ip: "203.0.113.7" }));
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

describe("catalog boxes: daily limit per internet address", () => {
  it("allows 10 sends from one address (email and text together), then the usual could-not-send line, nothing sent", async () => {
    expect(MAX_CATALOG_REQUESTS_PER_IP_PER_DAY).toBe(10);
    for (let i = 0; i < 5; i++) expect((await requestCatalogAction(null, form({ email: `p${i}@example.com` }))).ok).toBe(true);
    for (let i = 0; i < 5; i++) expect((await textCatalogAction(null, form({ phone: `84555502${10 + i}`, consent: "yes" }))).ok).toBe(true);
    expect(h.sent).toHaveLength(10);

    const e = await requestCatalogAction(null, form({ email: "eleven@example.com" }));
    expect(e).toEqual({ ok: false, message: CATALOG_FORM_DRAFT.failed });
    const t = await textCatalogAction(null, form({ phone: "8455550299", consent: "yes" }));
    expect(t).toEqual({ ok: false, message: CATALOG_FORM_DRAFT.failed });
    expect(h.sent).toHaveLength(10);
    // no consent record for the refused number
    expect(await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455550299"))).toHaveLength(0);
    // the refusals are in the activity log with the address
    const limits = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "catalog.website_limit"));
    expect(limits).toHaveLength(2);
    expect(limits[0].ip).toBe("203.0.113.7");
  });

  it("another address is not affected", async () => {
    h.ip = "198.51.100.4";
    expect((await requestCatalogAction(null, form({ email: "other@example.com" }))).ok).toBe(true);
    expect((await textCatalogAction(null, form({ phone: "8455550300", consent: "yes" }))).ok).toBe(true);
    const [rec] = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455550300"));
    expect(rec).toMatchObject({ ip: "198.51.100.4", userAgent: "UA", pageUrl: "https://hupupattractions.com/" });
  });
});
