import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({ inserts: [] as { table: unknown; v: Record<string, unknown> }[], rows: [] as unknown[] }));
vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const q = (): unknown => {
    const p: Record<string, unknown> = { from: () => p, where: () => p, orderBy: () => p, limit: () => p, then: (r: (v: unknown) => void) => r(h.rows) };
    return p;
  };
  return {
    schema,
    db: {
      select: () => q(),
      insert: (t: unknown) => ({ values: (v: Record<string, unknown>) => (h.inserts.push({ table: t, v }), { returning: () => Promise.resolve([{ id: 77 }]), then: (r: (v: unknown) => void) => r(undefined) }) }),
    },
  };
});
const { schema } = await import("@/lib/db");
const t = await import("@/lib/rental-terms");

beforeEach(() => {
  h.inserts = [];
  h.rows = [];
  process.env.AUTH_SECRET = "test-secret-at-least-24-characters-long";
});

describe("rental terms acceptance evidence", () => {
  it("stores the full terms text, version, hash, statement, order, phone, amount and request details", async () => {
    const id = await t.recordTermsAcceptance({ orderId: 5, customerId: 9, phone: "+18455550100", termsVersion: "rental-v1", termsText: "TERMS", method: "web_checkbox", acceptanceStatement: "I agree", amountCents: 25000, ip: "1.2.3.4", userAgent: "UA", pageUrl: "https://x/pay/5" });
    expect(id).toBe(77);
    expect(h.inserts[0].table).toBe(schema.termsAcceptances);
    expect(h.inserts[0].v).toMatchObject({ orderId: 5, phone: "+18455550100", termsVersion: "rental-v1", termsText: "TERMS", termsHash: t.termsHash("TERMS"), acceptanceStatement: "I agree", amountCents: 25000, ip: "1.2.3.4" });
  });
  it("refuses an empty terms text or acceptance statement", async () => {
    await expect(t.recordTermsAcceptance({ orderId: 5, termsVersion: "v", termsText: " ", method: "web_checkbox", acceptanceStatement: "x" })).rejects.toThrow();
    await expect(t.recordTermsAcceptance({ orderId: 5, termsVersion: "v", termsText: "T", method: "web_checkbox", acceptanceStatement: "" })).rejects.toThrow();
  });
  it("hash changes when a single character of the terms changes", () => {
    expect(t.termsHash("A")).not.toBe(t.termsHash("A."));
  });
  it("pay link token is per order and verified safely", () => {
    const tok = t.payToken(5);
    expect(t.verifyPayToken(5, tok)).toBe(true);
    expect(t.verifyPayToken(6, tok)).toBe(false);
    expect(t.verifyPayToken(5, "nope")).toBe(false);
    expect(t.verifyPayToken(5, null)).toBe(false);
  });
  it("payment is linked to the accepted terms in the audit log (or flagged when none)", async () => {
    h.rows = [{ id: 3, termsVersion: "rental-v1", termsHash: "abc", acceptedAt: new Date() }];
    await t.linkPaymentToAcceptance(5, "REF1", 25000);
    expect(h.inserts[0].v).toMatchObject({ action: "payment.terms_accepted", entityId: "5", after: expect.objectContaining({ acceptanceId: 3, termsVersion: "rental-v1", paymentRef: "REF1" }) });
    h.rows = [];
    await t.linkPaymentToAcceptance(6, "REF2", 100);
    expect(h.inserts[1].v.action).toBe("payment.no_terms_acceptance");
  });
  it("migration 0008 is add-only and makes acceptances permanent; webhook links payments", () => {
    const sql = readFileSync("drizzle/0008_rental_terms_acceptance.sql", "utf8");
    expect(sql).toContain('CREATE TABLE "terms_acceptances"');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "terms_acceptances"');
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|ALTER COLUMN|RENAME)\b/i);
    expect(readFileSync("src/app/api/sola/webhook/route.ts", "utf8")).toContain("linkPaymentToAcceptance(orderId");
  });
});
