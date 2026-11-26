// Pin the Shabbes and Yom Tov lock to a Tuesday, so the suite never depends on the day it runs.
process.env.HUP_CALENDAR_NOW ??= "2026-11-17T17:00:00Z";

// Older wording tests read each menu line as one sentence; the half-second option pauses (Nov 19, 2026) are tested
// on their own in tests/nov19-phone-batch.test.ts
process.env.IVR_OPTION_PAUSES = "off";

// Hark's review M12 (Nov 26, 2026): the tests may only ever use a database on this machine. A DATABASE_URL that points
// anywhere else (for example the live Neon database) stops the run before any test can write to it.
{
  const url = process.env.DATABASE_URL;
  if (url) {
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      host = "unreadable";
    }
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
      throw new Error(`Tests refuse to run against a database that is not on this machine (host: ${host}). Unset DATABASE_URL or point it at a local test database.`);
    }
  }
}
