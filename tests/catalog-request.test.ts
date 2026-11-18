import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Website: "Or text CATALOG to (845) 415-7585." and "Email me the catalog" (Abraham, Nov 18, 2026). In-memory database. */
const h = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/catalog-send", async (orig) => ({ ...(await orig<typeof import("@/lib/catalog-send")>()), sendCatalogEmail: async (to: string) => (h.sent.push(to), { sent: true }), recordCatalogRequest: async () => null }));

import { requestCatalogAction } from "@/app/catalog-actions";
import { CATALOG_EMAIL_BUTTON, CATALOG_TEXT_LINE, websiteCatalogFormShown } from "@/lib/catalog-request";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe("website catalog request", () => {
  it("approved wording; preview only until Abraham approves the screenshot", () => {
    expect(`${CATALOG_TEXT_LINE.before}${CATALOG_TEXT_LINE.phone}${CATALOG_TEXT_LINE.after}`).toBe("Or text CATALOG to (845) 415-7585.");
    expect(CATALOG_EMAIL_BUTTON).toBe("Email me the catalog");
    expect(websiteCatalogFormShown({ VERCEL_ENV: "production" })).toBe(false);
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
});
