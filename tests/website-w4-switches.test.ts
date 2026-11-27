import { describe, expect, it, vi } from "vitest";

/* Website Phase W4 (Admin handoff, Nov 27, 2026): the catalog card switch and the catalog sends per internet address are
   Admin settings, starting as today (on, 10). In-memory database. */
const h = vi.hoisted(() => ({ sent: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.50" }) }));
vi.mock("@/lib/catalog-send", async (orig) => ({
  ...(await orig<typeof import("@/lib/catalog-send")>()),
  sendCatalogEmail: async (to: string) => (h.sent.push(to), { sent: true }),
  recordCatalogRequest: async () => null,
  replyToCatalogText: async (to: string) => (h.sent.push(`text:${to}`), { replied: true, reason: null }),
}));

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { requestCatalogAction, textCatalogAction } from "@/app/catalog-actions";
import { CATALOG_FORM_DRAFT, catalogCardOn } from "@/lib/catalog-request";
import { SETTING_DEFAULTS, clearSettingsCache } from "@/lib/settings";
import { configDef } from "@/lib/config-registry";
import { CONFIG_EXPLANATIONS } from "@/lib/config-explanations";
import { featureSwitches } from "@/lib/feature-switches";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const setSetting = async (key: string, value: unknown) => {
  await db.insert(schema.appSettings).values({ key, value: value as never }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value: value as never } });
  clearSettingsCache();
};

describe("website switches in Admin (W4)", () => {
  it("start as today (card on, 10 a day), editable with checks and explanations, linked from the feature switch list", async () => {
    expect([SETTING_DEFAULTS.siteCatalogCardOn, SETTING_DEFAULTS.siteCatalogSendsPerAddressPerDay]).toEqual([true, "10"]);
    for (const k of ["siteCatalogCardOn", "siteCatalogSendsPerAddressPerDay"]) {
      expect([configDef(k)!.mode, configDef(k)!.group], k).toEqual(["edit", "Website: switches"]);
      expect(CONFIG_EXPLANATIONS[k]?.what, k).toBeTruthy();
    }
    expect(configDef("siteCatalogSendsPerAddressPerDay")!.rule!("0")).toMatch(/1 to 100/);
    expect(featureSwitches(SETTING_DEFAULTS as never).find((f) => f.id === "website_catalog_form")).toMatchObject({ state: "On", settingKey: "siteCatalogCardOn" });
    expect(await catalogCardOn({ VERCEL_ENV: "production" })).toBe(true);
  });
  it("the limit follows the setting", async () => {
    await setSetting("siteCatalogSendsPerAddressPerDay", "2");
    expect((await requestCatalogAction(null, form({ email: "a1@example.com" }))).ok).toBe(true);
    expect((await textCatalogAction(null, form({ phone: "8455550401", consent: "yes" }))).ok).toBe(true);
    expect(await requestCatalogAction(null, form({ email: "a3@example.com" }))).toEqual({ ok: false, message: CATALOG_FORM_DRAFT.failed });
    expect(h.sent).toHaveLength(2);
  });
  it("switched off: the card is gone (the approved email line stays) and neither box sends anything", async () => {
    await setSetting("siteCatalogSendsPerAddressPerDay", "10");
    await setSetting("siteCatalogCardOn", false);
    expect(await catalogCardOn({ VERCEL_ENV: "production" })).toBe(false);
    const before = h.sent.length;
    expect(await requestCatalogAction(null, form({ email: "off@example.com" }))).toEqual({ ok: false, message: CATALOG_FORM_DRAFT.failed });
    expect(await textCatalogAction(null, form({ phone: "8455550402", consent: "yes" }))).toEqual({ ok: false, message: CATALOG_FORM_DRAFT.failed });
    expect(h.sent.length).toBe(before);
    expect(readFileSync("src/app/page.tsx", "utf8")).toContain("websiteCatalogFormShown() && settings.siteCatalogCardOn !== false ? (");
  });
});
