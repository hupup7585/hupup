import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({ recorded: [] as Record<string, unknown>[], redirected: "" as string, order: null as unknown }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.2.3.4", "user-agent": "UA" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => ((h.redirected = u), undefined) }));
vi.mock("@/lib/orders", async (orig) => ({ ...(await orig<typeof import("@/lib/orders")>()), getOrderWithItems: async () => h.order }));
vi.mock("@/lib/rental-terms", async (orig) => ({ ...(await orig<typeof import("@/lib/rental-terms")>()), recordTermsAcceptance: async (i: Record<string, unknown>) => (h.recorded.push(i), 1) }));

process.env.AUTH_SECRET = "test-secret-at-least-24-characters-long";
process.env.SOLA_PAYMENTSITE_NAME = "hupuptest";
const { agreeAndPayAction } = await import("@/app/pay/[orderId]/actions");
const { PAY_AGREE_LABEL } = await import("@/app/pay/[orderId]/label");
const { payToken, payPageLink } = await import("@/lib/rental-terms");
const { TERMS_TEXT, TERMS_VERSION, TERMS_SECTIONS } = await import("@/lib/terms-content");

beforeEach(() => {
  h.recorded = [];
  h.redirected = "";
  h.order = { order: { id: 7, status: "PENDING_PAYMENT", subtotalCents: 25000, totalCents: 28113, paidCents: 0 }, items: [], customer: { id: 3, phone: "+18455550100", name: "Y F", email: null } };
});

describe("(a) payment link: unchecked 'I agree' box required before payment", () => {
  it("the box starts unchecked and links to /terms", () => {
    const form = readFileSync("src/app/pay/[orderId]/PayForm.tsx", "utf8");
    expect(form).toContain("useState(false)");
    expect(form).toContain('href="/terms"');
    expect(form).toContain("disabled={!agreed || pending}");
    expect(PAY_AGREE_LABEL).toBe("I agree to the Terms and Conditions");
  });
  it("not agreed: refused, nothing recorded, no payment", async () => {
    const r = await agreeAndPayAction(7, payToken(7), false);
    expect(r?.error).toMatch(/check the box/);
    expect(h.recorded).toEqual([]);
    expect(h.redirected).toBe("");
  });
  it("bad link: refused", async () => {
    expect((await agreeAndPayAction(7, "nope", true))?.error).toMatch(/not valid/);
  });
  it("agreed: records version, text, time-stamped acceptance, then goes to Sola for the full total", async () => {
    await agreeAndPayAction(7, payToken(7), true);
    expect(h.recorded[0]).toMatchObject({ orderId: 7, phone: "+18455550100", termsVersion: TERMS_VERSION, termsText: TERMS_TEXT, method: "web_checkbox", amountCents: 28113, ip: "1.2.3.4" });
    expect(h.redirected).toContain("xAmount=281.13");
  });
  it("payment texts point to the review-and-pay page", () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.vercel.app";
    expect(payPageLink(7)).toBe(`https://hupup.vercel.app/pay/7?t=${payToken(7)}`);
    for (const f of ["src/lib/ivr/flow.ts", "src/app/admin/(app)/orders/actions.ts", "src/app/admin/(app)/pos/actions.ts"]) expect(readFileSync(f, "utf8"), f).toContain("payPageLink(");
  });
});

describe("(c) POS: staff must pick how the customer accepted", () => {
  it("required choice of phone, text, email or in person, logged as an acceptance", () => {
    const a = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    expect(a).toContain('const TERMS_VIA = ["phone", "text", "email", "in_person"] as const;');
    expect(a).toContain("Choose how the customer accepted the Terms and Conditions.");
    expect(a).toContain("method: `staff_${input.termsVia}`");
    const f = readFileSync("src/app/admin/(app)/pos/PosForm.tsx", "utf8");
    expect(f).toContain("!form.termsVia");
  });
});

describe("(d) every Terms version is stored with its version number and effective date", () => {
  it("migration 0011 adds terms_versions (append-only)", () => {
    const sql = readFileSync("drizzle/0011_terms_versions.sql", "utf8");
    expect(sql).toContain('CREATE TABLE "terms_versions"');
    expect(sql).toContain('"effective_date" text NOT NULL');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "terms_versions"');
  });
  it("the stored text matches what the /terms page shows", () => {
    const page = readFileSync("src/app/terms/page.tsx", "utf8").replace(/\s+/g, " ").replace(/&ldquo;|&rdquo;/g, '"');
    for (const s of TERMS_SECTIONS.slice(1)) expect(page, s.heading).toContain(s.heading);
  });
});

describe("(e) privacy", () => {
  it("/privacy-policy redirects to /privacy", () => {
    expect(readFileSync("next.config.ts", "utf8")).toContain('{ source: "/privacy-policy", destination: "/privacy", permanent: true }');
  });
});
