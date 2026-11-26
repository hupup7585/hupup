// Pin the Shabbes and Yom Tov lock to a Tuesday, so the suite never depends on the day it runs.
process.env.HUP_CALENDAR_NOW ??= "2026-11-17T17:00:00Z";

// Older wording tests read each menu line as one sentence; the half-second option pauses (Nov 19, 2026) are tested
// on their own in tests/nov19-phone-batch.test.ts
process.env.IVR_OPTION_PAUSES = "off";

// Hark's review M12 and the Phases 1-3 review item 2 (Nov 26, 2026): the tests may only ever use a database on this
// machine. The .env file's database address is read FIRST (so a DATABASE_URL in it cannot slip in after this check), then any database
// address that is not on this machine stops the run before a test can write to it. TEST_DATABASE_URL, when set, is
// the one the tests use.
import { existsSync, readFileSync } from "node:fs";
import { parse } from "dotenv";

{
  // Only the database address is taken from .env (every other value in it stays out of the tests)
  const envPath = process.env.DOTENV_CONFIG_PATH || ".env";
  if (existsSync(envPath)) {
    const file = parse(readFileSync(envPath));
    for (const k of ["DATABASE_URL", "TEST_DATABASE_URL"]) if (file[k] && process.env[k] === undefined) process.env[k] = file[k];
  }
  const LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"];
  const hostOf = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return "unreadable";
    }
  };
  if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const url = process.env.DATABASE_URL;
  if (url) {
    const host = hostOf(url);
    if (!LOCAL.includes(host)) {
      throw new Error(`Tests refuse to run against a database that is not on this machine (host: ${host}). Unset DATABASE_URL or point TEST_DATABASE_URL at a local test database.`);
    }
  }
}
