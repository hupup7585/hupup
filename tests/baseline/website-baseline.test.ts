import { describe, expect, it, vi } from "vitest";

// no database in this test: the settings fall back to their starting values (with no Admin change, as on the live site)
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("../helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

/*
 * Website Phase W1 baseline (Admin handoff, website part, Nov 27, 2026): every customer-facing text the website code
 * holds today, and every public page's title, description and canonical address. Later phases move these into Admin;
 * with no Admin change this snapshot must stay exactly the same (any difference fails the normal test run).
 * The rendered pages themselves are saved by scripts/website-baseline.mjs in docs/handoff/website-baseline.json.
 */
const pick = (m: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === "string" || Array.isArray(v) || (v !== null && typeof v === "object" && !(v instanceof Function))).sort(([a], [b]) => a.localeCompare(b)));

describe("website baseline (W1)", () => {
  it("home page words (site-copy)", async () => {
    expect(pick(await import("@/lib/site-copy"))).toMatchSnapshot();
  });
  it("catalog card, consent boxes, SMS words shown on the website", async () => {
    const catalog = await import("@/lib/catalog-request-copy");
    const consent = await import("@/lib/sms-consent-copy");
    const v2 = await import("@/lib/sms-terms-v2");
    expect({
      catalog: pick(catalog),
      consent: pick(consent),
      webConsent: v2.webConsentCopy({ VERCEL_ENV: "production" }),
      privacyV2: v2.PRIVACY_V2,
      examples: v2.MESSAGE_EXAMPLES,
      serviceTypes: v2.SERVICE_TEXT_TYPES,
      notActive: v2.smsSignupNotActive({ VERCEL_ENV: "production" }),
    }).toMatchSnapshot();
  });
  it("pay link, error page and unsubscribe words", async () => {
    const late = await import("@/lib/late-payment");
    const link = Object.fromEntries(Object.entries(late.LINK_TEXT).map(([k, v]) => [k, typeof v === "function" ? [(v as (n: number) => string)(1), (v as (n: number) => string)(2), (v as (n: number) => string)(10)] : v]));
    const label = await import("@/app/pay/[orderId]/label");
    expect({ link, label: pick(label), error: pick(await import("@/lib/error-page-copy")), unsubscribe: (await import("@/lib/unsubscribe")).UNSUBSCRIBE_TEXT }).toMatchSnapshot();
  });
  it("every public page's title, description and canonical address", async () => {
    const pages: Record<string, () => Promise<{ metadata?: unknown; generateMetadata?: () => Promise<unknown> }>> = {
      "/": () => import("@/app/page"),
      "/privacy": () => import("@/app/privacy/page"),
      "/terms": () => import("@/app/terms/page"),
      "/sms-terms": () => import("@/app/sms-terms/page"),
      "/text-alerts": () => import("@/app/text-alerts/page"),
      "/paid": () => import("@/app/paid/page"),
      "/pay": () => import("@/app/pay/[orderId]/page"),
      "/unsubscribe": () => import("@/app/unsubscribe/page"),
    };
    const out: Record<string, unknown> = {};
    for (const [p, load] of Object.entries(pages)) {
      const mod = await load();
      // W3: pages with an Admin search listing build it in generateMetadata (no Admin change: the same words)
      const m = (mod.generateMetadata ? await mod.generateMetadata() : mod.metadata) as Record<string, unknown> | undefined;
      out[p] = m ? { title: m.title, description: m.description, canonical: (m.alternates as { canonical?: string } | undefined)?.canonical, openGraph: m.openGraph } : null;
    }
    expect(out).toMatchSnapshot();
  });
  it("one H1 on every page in the saved rendered baseline", async () => {
    const { readFileSync } = await import("node:fs");
    const saved = JSON.parse(readFileSync("docs/handoff/website-baseline.json", "utf8")) as Record<string, { h1: string[] }>;
    for (const [p, v] of Object.entries(saved)) expect(v.h1, p).toHaveLength(1);
  });
});
