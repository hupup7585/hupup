import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Website: "Or text CATALOG to (845) 415-7585." and "Email me the catalog" (Abraham, Nov 18, 2026). In-memory database. */
const h = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/catalog-send", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalog-send")>()),
  sendCatalogEmail: async (to: string) => (h.sent.push(to), { sent: true }),
  recordCatalogRequest: async () => null,
  // once per number per day, like the real one
  replyToCatalogText: async (to: string, o: { optedOut: boolean }) =>
    o.optedOut ? { replied: false, reason: "opted_out" } : h.sent.includes(`text:${to}`) ? { replied: false, reason: "already_today" } : (h.sent.push(`text:${to}`), { replied: true, reason: null }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requestCatalogAction, textCatalogAction } from "@/app/catalog-actions";
import { CATALOG_EMAIL_BUTTON, CATALOG_FORM_DRAFT, websiteCatalogFormShown } from "@/lib/catalog-request";
import { CATALOG_TEXT_CONSENT, CATALOG_TEXT_DRAFT, CATALOG_TEXT_FINE_PRINT } from "@/lib/catalog-request-copy";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("website catalog request", () => {
  it("approved wording; live since Abraham approved the card (Nov 19, 2026)", () => {
    // Abraham, Nov 24, 2026: the "Or text CATALOG to (845) 415-7585." line is gone everywhere; the email box stays
    for (const f of ["src/components/site/CatalogRequest.tsx", "src/lib/catalog-request-copy.ts", "src/app/page.tsx"]) expect(readFileSync(f, "utf8"), f).not.toMatch(/text CATALOG|body=CATALOG/i);
    expect(CATALOG_EMAIL_BUTTON).toBe("Email me the catalog");
    expect(websiteCatalogFormShown({ VERCEL_ENV: "production" })).toBe(true);
    expect(websiteCatalogFormShown({ VERCEL_ENV: "preview" })).toBe(true);
    expect(readFileSync("src/components/site/CatalogRequest.tsx", "utf8")).not.toContain("@/lib/db");
  });
  it("sends the real catalog email once per address per day; refuses bad addresses; robots get nothing", async () => {
    expect((await requestCatalogAction(null, form({ email: "nope" }))).ok).toBe(false);
    expect((await requestCatalogAction(null, form({ email: "Sara@Example.com" }))).ok).toBe(true);
    expect(h.sent).toEqual(["sara@example.com"]);
    await requestCatalogAction(null, form({ email: "sara@example.com" }));
    expect(h.sent).toHaveLength(1);
    await requestCatalogAction(null, form({ email: "bot@example.com", website: "x" }));
    expect(h.sent).toHaveLength(1);
  });
  it("Text me the catalog: a 10-digit number gets the catalog texts (key 8's rules); bad numbers refused", async () => {
    expect((await textCatalogAction(null, form({ phone: "12345", consent: "yes" }))).ok).toBe(false);
    expect((await textCatalogAction(null, form({ phone: "(845) 555-0144", consent: "yes" }))).ok).toBe(true);
    expect(h.sent).toContain("text:+18455550144");
  });
});

/* Plan A (Abraham, Nov 27, 2026, 1:52 AM): unticked box, disabled button, consent record, STOP, one a day. */
describe("catalog by text: consent box", () => {
  it("the box starts unticked and the button stays off until it is ticked; his exact words under the button", () => {
    const src = readFileSync("src/components/site/CatalogRequest.tsx", "utf8");
    expect(src).toContain("useState(false)");
    expect(src).toMatch(/disabled=\{tPending \|\| !agreed\}/);
    expect(src).toContain("data-sms-grey-line");
    expect(CATALOG_TEXT_CONSENT).toBe("Yes, text the Hup Up Attractions catalog to this number.");
    expect(CATALOG_TEXT_FINE_PRINT).toBe("Message and data rates may apply."); // Nov 27, 2026 (item 5): only this sentence
  });
  it("unticked: nothing sent, no record", async () => {
    const before = h.sent.length;
    const r = await textCatalogAction(null, form({ phone: "8455550170" }));
    expect(r.ok).toBe(false);
    expect(h.sent.length).toBe(before);
    expect(await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455550170"))).toHaveLength(0);
  });
  it("ticked: one catalog send and a consent record with the exact box wording", async () => {
    const before = h.sent.length;
    expect((await textCatalogAction(null, form({ phone: "8455550171", consent: "yes" }))).ok).toBe(true);
    expect(h.sent.slice(before)).toEqual(["text:+18455550171"]);
    const [rec] = await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455550171"));
    expect(rec).toMatchObject({ scope: "catalog", action: "opt_in", source: "web", method: "checkbox", wording: CATALOG_TEXT_CONSENT });
    expect(rec.createdAt).toBeTruthy();
  });
  it("second request the same day: nothing sent, a message shown", async () => {
    const before = h.sent.length;
    const r = await textCatalogAction(null, form({ phone: "8455550171", consent: "yes" }));
    expect(h.sent.length).toBe(before);
    expect(r.message).toBe(CATALOG_FORM_DRAFT.textAgain);
  });
  it("a number that replied STOP: nothing sent, no consent record, a plain message", async () => {
    await db.insert(schema.customers).values({ phone: "+18455550172", name: null, smsOptOut: true });
    const before = h.sent.length;
    const r = await textCatalogAction(null, form({ phone: "8455550172", consent: "yes" }));
    expect(r.ok).toBe(false);
    expect(h.sent.length).toBe(before);
    expect(r.message).toBe(CATALOG_TEXT_DRAFT.stopped);
    expect(await db.select().from(schema.smsConsents).where(eq(schema.smsConsents.phone, "+18455550172"))).toHaveLength(0);
  });
});

