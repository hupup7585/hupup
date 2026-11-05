import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/db", async () => ({ db: {}, schema: await vi.importActual("@/lib/db/schema") }));
const { findComplianceIssues, REVIEW_INTERVAL_DAYS } = await import("@/lib/compliance");

const P = "+18455550100";
const at = (iso: string) => new Date(iso);
const msg = (o: Record<string, unknown>) => ({ id: 1, contactPhone: P, body: "Hup Up Attractions: Reply STOP to opt out. Sale", kind: "marketing", event: null, status: "delivered", customerId: 9, createdAt: at("2026-07-01T16:00:00Z"), ...o });
const con = (o: Record<string, unknown>) => ({ id: 1, phone: P, scope: "marketing", action: "opt_in", source: "web", disclosureRead: null, correctsConsentId: null, createdAt: at("2026-06-01T12:00:00Z"), ...o });

describe("12. automatic compliance checks", () => {
  it("a compliant promotional text produces no findings", () => {
    expect(findComplianceIssues({ messages: [msg({})], consents: [con({})], customers: [{ id: 9, timeZone: null }] })).toEqual([]);
  });
  it("flags a promo with no promotional opt-in at the time it was sent", () => {
    const f = findComplianceIssues({ messages: [msg({})], consents: [con({ createdAt: at("2026-08-01T00:00:00Z") })], customers: [] });
    expect(f.map((x) => x.check)).toContain("promo_without_consent");
  });
  it("flags a promo after a NOPROMO/STOP opt-out", () => {
    const f = findComplianceIssues({ messages: [msg({})], consents: [con({ id: 1 }), con({ id: 2, action: "opt_out", source: "keyword", createdAt: at("2026-06-20T00:00:00Z") })], customers: [] });
    expect(f.map((x) => x.check)).toContain("promo_without_consent");
  });
  it("flags a promo outside quiet hours and one missing the required opening", () => {
    const f = findComplianceIssues({ messages: [msg({ createdAt: at("2026-07-02T02:00:00Z"), body: "Sale!" })], consents: [con({})], customers: [] });
    expect(f.map((x) => x.check).sort()).toEqual(["promo_missing_opening", "promo_quiet_hours"]);
  });
  it("blocked or canceled messages are not findings", () => {
    expect(findComplianceIssues({ messages: [msg({ status: "blocked", body: "Sale!" }), msg({ id: 2, status: "canceled" })], consents: [], customers: [] })).toEqual([]);
  });
  it("flags any text after STOP except the opt-out confirmation, until a new opt-in", () => {
    const stop = con({ id: 5, scope: "transactional", action: "opt_out", source: "keyword", createdAt: at("2026-06-15T00:00:00Z") });
    const after = msg({ id: 7, kind: "transactional", body: "Your order", createdAt: at("2026-06-16T15:00:00Z") });
    const confirm = msg({ id: 8, kind: "system", event: "opt_out_confirmation", body: "Unsubscribed", createdAt: at("2026-06-15T00:00:01Z") });
    expect(findComplianceIssues({ messages: [after, confirm], consents: [stop], customers: [] }).map((x) => [x.check, x.messageId])).toEqual([["sent_after_opt_out", 7]]);
    const restart = con({ id: 6, scope: "transactional", action: "opt_in", source: "keyword", createdAt: at("2026-06-16T00:00:00Z") });
    expect(findComplianceIssues({ messages: [after], consents: [stop, restart], customers: [] })).toEqual([]);
  });
  it("flags a staff opt-in without the full disclosure (corrections excluded)", () => {
    const f = findComplianceIssues({ messages: [], consents: [con({ id: 3, source: "staff", disclosureRead: false }), con({ id: 4, source: "staff", disclosureRead: null, correctsConsentId: 3 })], customers: [] });
    expect(f.map((x) => [x.check, x.consentId])).toEqual([["staff_optin_without_disclosure", 3]]);
  });
});

describe("12. review, reporting and permissions", () => {
  it("review every 30 days; review is Owner-only; any staff can report and the owner is notified", () => {
    expect(REVIEW_INTERVAL_DAYS).toBe(30);
    const a = readFileSync("src/app/admin/(app)/compliance/actions.ts", "utf8");
    expect(a).toContain("isOwnerSession(session.userId)");
    expect(a.match(/requireAdmin\(\)/g)).toHaveLength(2);
    const lib = readFileSync("src/lib/compliance.ts", "utf8");
    expect(lib).toContain('action: "compliance.issue_reported"');
    expect(lib).toContain("config.adminPhone()");
    expect(lib).toContain("config.adminEmail()");
    expect(lib).toContain('action: "compliance.review_completed"');
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('"/admin/compliance"');
  });
  it("policy has the full clause 12 text and the enforcement table", () => {
    const d = readFileSync("docs/sms-compliance-policy.md", "utf8");
    expect(d).toContain("The Company messaging system must enforce this policy automatically wherever technically possible. Required controls include separate transactional and promotional consent records, approved message templates, promotional quiet-hour restrictions, automatic opt-out processing, employee permissions, and retention of communication records.");
    expect(d).toContain("Management must periodically review system activity, employee access, consent records, opt-out processing, and promotional message history. Any suspected compliance failure must be reported to the policy owner immediately and corrected promptly.");
    expect(d).not.toContain("wherever technic[");
    for (const c of ["Approved message templates", "Promotional quiet hours", "Automatic opt-out processing", "Employee permissions", "Retention of communication records"]) expect(d).toContain(c);
  });
});
