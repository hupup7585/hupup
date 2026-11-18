import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { bridgeKeyOk, parseWhen } from "@/lib/sola-bridge";

/* Sola bridge (Abraham, Nov 18, 2026): read and void only, behind a separate admin API key. */
describe("Sola bridge", () => {
  it("off until a long key is saved in Vercel; only the exact key opens it", () => {
    expect(bridgeKeyOk("anything", {})).toBe(false);
    expect(bridgeKeyOk("short", { SOLA_BRIDGE_API_KEY: "short" })).toBe(false);
    const k = "k".repeat(32);
    expect(bridgeKeyOk(k, { SOLA_BRIDGE_API_KEY: k })).toBe(true);
    expect(bridgeKeyOk(`${k}x`, { SOLA_BRIDGE_API_KEY: k })).toBe(false);
    expect(bridgeKeyOk(null, { SOLA_BRIDGE_API_KEY: k })).toBe(false);
  });
  it("dates", () => {
    expect(parseWhen("2026-11-18")?.toISOString()).toBe("2026-11-18T05:00:00.000Z");
    expect(parseWhen("nope")).toBeNull();
  });
  it("read and void only: no sale command anywhere in the bridge; both routes check the key first", () => {
    for (const f of ["src/app/api/admin/sola/transactions/route.ts", "src/app/api/admin/sola/void/route.ts", "src/lib/sola-bridge.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toMatch(/cc:sale|cc:authonly|cc:capture/i);
    }
    expect(readFileSync("src/app/api/admin/sola/void/route.ts", "utf8")).toContain('if (!bridgeKeyOk(req.headers.get("x-admin-api-key"))) return new Response("Unauthorized", { status: 401 });');
    expect(readFileSync("src/app/api/admin/sola/transactions/route.ts", "utf8")).toContain('if (!bridgeKeyOk(req.headers.get("x-admin-api-key"))) return new Response("Unauthorized", { status: 401 });');
  });
});
