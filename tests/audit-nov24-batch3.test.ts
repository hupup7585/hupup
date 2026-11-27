import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseWhen } from "@/lib/sola-bridge";

/* Code audit Nov 24: M9, L4, L5, L8. */
describe("code audit Nov 24, batch 3", () => {
  it("L5: report days use New York time with summer time", () => {
    expect(parseWhen("2026-07-01")?.toISOString()).toBe("2026-07-01T04:00:00.000Z");
    expect(parseWhen("2026-11-18")?.toISOString()).toBe("2026-11-18T05:00:00.000Z");
    expect(parseWhen("2026-07-01", true)?.toISOString()).toBe("2026-07-02T03:59:59.000Z");
  });
  it("L4: the daily job refuses when no secret is set", async () => {
    const old = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const { GET } = await import("@/app/api/cron/release-holds/route");
    expect((await GET(new Request("https://x/api/cron/release-holds"))).status).toBe(401);
    if (old) process.env.CRON_SECRET = old;
  });
  it("M9: orders, New booking and design pages check the sign-in themselves", () => {
    for (const f of ["orders", "pos", "design"]) expect(readFileSync(`src/app/admin/(app)/${f}/page.tsx`, "utf8"), f).toContain("await requireAdmin()");
  });
  it("L8: POS quantities are whole numbers 1 to 99", () => {
    const s = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    expect(s).toContain("Each quantity must be a whole number from 1 to 99.");
    expect(s).toContain("!Number.isInteger(i.qty) || i.qty < 1 || i.qty > 99");
  });
});
