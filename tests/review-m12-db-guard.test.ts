import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's review M12 (Nov 26, 2026): the test setup stops the run when DATABASE_URL points at a remote database. */
describe("tests never touch a remote database", () => {
  it("the setup file refuses any host but this machine", () => {
    const setup = readFileSync("tests/setup.ts", "utf8");
    expect(setup).toContain("Tests refuse to run against a database that is not on this machine");
    expect(setup).toMatch(/\["localhost", "127\.0\.0\.1"/);
  });
  it("this run itself is local (or has no database at all)", () => {
    const url = process.env.DATABASE_URL;
    if (url) expect(["localhost", "127.0.0.1"]).toContain(new URL(url).hostname);
  });
});
