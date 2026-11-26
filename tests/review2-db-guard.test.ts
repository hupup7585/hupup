import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* Hark's Phases 1-3 review, item 2 (Nov 26, 2026): a .env file holding a remote database address can never reach the
 * integration tests: the setup reads .env first and refuses anything not on this machine. */
describe("the test database guard", () => {
  it("a .env with a remote address stops the run with the refusal message", () => {
    const dir = mkdtempSync(join(tmpdir(), "hup-env-"));
    const envFile = join(dir, ".env");
    writeFileSync(envFile, "DATABASE_URL=postgres://user:pw@remote-db.example.invalid:5432/live\n");
    const env = { ...process.env, DOTENV_CONFIG_PATH: envFile } as Record<string, string | undefined>;
    delete env.DATABASE_URL;
    delete env.TEST_DATABASE_URL;
    const r = spawnSync("npx", ["vitest", "run", "tests/reserve.int.test.ts"], { env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 120_000 });
    const out = `${r.stdout}${r.stderr}`;
    expect(out).toContain("Tests refuse to run against a database that is not on this machine (host: remote-db.example.invalid)");
    expect(r.status).not.toBe(0);
  }, 150_000);
  it("the integration tests no longer load .env themselves; the setup does, before the check", () => {
    for (const f of ["tests/reserve.int.test.ts", "tests/laser-stock.int.test.ts", "tests/sms.int.test.ts"]) expect(readFileSync(f, "utf8")).not.toContain("dotenv/config");
    const setup = readFileSync("tests/setup.ts", "utf8");
    expect(setup.indexOf('for (const k of ["DATABASE_URL", "TEST_DATABASE_URL"])')).toBeGreaterThan(-1);
    expect(setup.indexOf('for (const k of ["DATABASE_URL", "TEST_DATABASE_URL"])')).toBeLessThan(setup.indexOf("Tests refuse to run"));
  });
});
