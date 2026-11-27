import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { signingSecret } from "@/lib/secret";

/* Code audit L6 (Nov 24, 2026): on the live site nothing is signed with the known test value. */
describe("signing key", () => {
  it("the live site refuses to sign without a real AUTH_SECRET", () => {
    expect(() => signingSecret({ NODE_ENV: "production" })).toThrow(/AUTH_SECRET must be set/);
    expect(() => signingSecret({ VERCEL_ENV: "production", AUTH_SECRET: "short" })).toThrow(/AUTH_SECRET must be set/);
    expect(signingSecret({ VERCEL_ENV: "production", AUTH_SECRET: "a-real-secret-that-is-long-enough" })).toBe("a-real-secret-that-is-long-enough");
  });
  it("tests and local development keep working", () => {
    expect(signingSecret({ NODE_ENV: "test" })).toBe("dev-secret");
  });
  it("no file signs with the test value directly any more", () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    for (const f of walk("src").filter((x) => /\.(ts|tsx)$/.test(x))) expect(readFileSync(f, "utf8"), f).not.toContain('AUTH_SECRET || "dev-secret"');
  });
});
