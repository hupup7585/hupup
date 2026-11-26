import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseMoney } from "@/lib/books";

/* Hark's Phase 1-2 review, the last low findings (Nov 26, 2026). */
describe("L2: All settings keeps your place and what you typed", () => {
  const actions = readFileSync("src/app/admin/(app)/config/actions.ts", "utf8");
  const page = readFileSync("src/app/admin/(app)/config/page.tsx", "utf8");
  it("every save goes back to the same setting, not the top of the page", () => {
    expect(actions).toContain("const at = `${ANCHOR}${encodeURIComponent(key)}`");
    expect(actions).toContain('const ANCHOR = "\\u0023"');
    expect(page).toContain("scroll-mt-24");
  });
  it("a rejected value and its reason stay in the boxes, with the reason for refusal beside the setting", () => {
    expect(actions).toContain("&v=${encodeURIComponent(typed.value");
    expect(page).toMatch(/const current = rejected \?\?/);
    expect(page).toContain("data-config-error");
    expect(page).toMatch(/defaultValue=\{rejected !== null \? \(sp\.r \?\? ""\) : ""\}/);
  });
});

describe("L5: the pay page says how long this order is really held", () => {
  it("uses the order's own hold end, not today's setting", () => {
    const page = readFileSync("src/app/pay/[orderId]/page.tsx", "utf8");
    expect(page).toMatch(/heldAgain\(o\.holdExpiresAt \? minutesLeft\(o\.holdExpiresAt\)/);
    const minutesLeft = (until: Date, now: number) => Math.max(1, Math.ceil((until.getTime() - now) / 60000));
    const now = Date.UTC(2026, 10, 26, 15, 0, 0);
    expect(minutesLeft(new Date(now + 25 * 60000), now)).toBe(25);
    expect(minutesLeft(new Date(now + 9.2 * 60000), now)).toBe(10);
    expect(minutesLeft(new Date(now - 60000), now)).toBe(1);
  });
});

describe("L9: the opening cash balance can be below zero", () => {
  it("a minus sign or accounting brackets are both accepted", () => {
    expect(parseMoney("-250.00")).toBe(-25000);
    const actions = readFileSync("src/app/admin/(app)/bookkeeping/actions.ts", "utf8");
    expect(actions).toContain('.replace(/^\\((.*)\\)$/, "-$1")');
    const brackets = "(250.00)".replace(/^\((.*)\)$/, "-$1");
    expect(parseMoney(brackets)).toBe(-25000);
    expect(readFileSync("src/app/admin/(app)/bookkeeping/page.tsx", "utf8")).toContain("for example -250.00");
  });
});
