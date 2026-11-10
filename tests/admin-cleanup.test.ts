import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/* Admin cleanup (Abraham, Nov 10, 2026): "number" instead of "#", plain wording, dates, confirmations on risky buttons. */
const files: string[] = [];
const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : /\.tsx?$/.test(f) && files.push(join(d, f))));
walk("src/app/admin");
const read = (p: string) => readFileSync(p, "utf8");
// Customer-facing text (emails, payment-link texts, the printed invoice, the stored acceptance statement) keeps its approved wording.
const CUSTOMER_FACING = [/deliveries\/actions\.ts$/, /orders\/actions\.ts$/, /pos\/actions\.ts$/, /invoice\/\[id\]\/page\.tsx$/];

describe("Admin cleanup", () => {
  it('staff screens say "number", never "#" before a number', () => {
    for (const f of files.filter((f) => !CUSTOMER_FACING.some((r) => r.test(f)))) {
      const code = read(f).replace(/#[0-9A-Fa-f]{3,8}\b/g, "");
      expect(code, f).not.toMatch(/#\{|#\$\{|"#"/);
    }
    expect(read("src/app/admin/(app)/pos/actions.ts")).toContain("Booked order number ${orderNumber(r.orderId)}.");
  });
  it("risky buttons ask first", () => {
    const B = "src/app/admin/(app)/";
    for (const [f, n] of [
      ["bookkeeping/Ledger.tsx", 1],
      ["bookkeeping/invoice/[id]/page.tsx", 1],
      ["bookkeeping/page.tsx", 3],
      ["campaigns/page.tsx", 2],
      ["customers/[id]/page.tsx", 1],
      ["voicemail/page.tsx", 1],
      ["calls/page.tsx", 1], // Block
    ] as const)
      expect((read(B + f).match(/<ConfirmSubmit /g) || []).length, f).toBeGreaterThanOrEqual(n);
    expect(read(B + "staff/StaffForms.tsx")).toContain('window.confirm("Deactivate this staff member?');
    expect(read(B + "orders/[id]/OrderActions.tsx")).toContain('confirm("Cancel this order and free the items?")');
  });
  it("setup details are tucked into Developer notes; settings rows use plain words", () => {
    const g = read("src/app/admin/(app)/settings/page.tsx");
    const visible = g.slice(0, g.indexOf("data-developer-notes")).replace(/process\.env\.[A-Z_]+/g, ""); // code, not screen text
    expect(visible).not.toMatch(/Add [A-Z_]{4,}|TWILIO_|RESEND_|SOLA_[A-Z]/);
    expect(g).toContain("Developer notes (for setup only)");
    expect(read("src/app/admin/(app)/phone/settings/page.tsx")).toContain("Developer notes: Twilio phone number setup");
  });
  it("dates on staff screens use the shared date format, not raw ISO or browser-locale times", () => {
    expect(read("src/app/admin/(app)/customers/[id]/page.tsx")).toContain("<DualDate iso={o.eventDate} />");
    expect(read("src/app/admin/(app)/bookkeeping/page.tsx")).toContain("<DualDate at={l.reopenedAt} />");
    expect(read("src/app/admin/(app)/orders/[id]/OrderActions.tsx")).toContain('timeZone: "America/New_York"');
  });
});
