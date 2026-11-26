import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Neon free plan (Abraham, Nov 26, 2026, 12:00 PM ET): the database must be able to sleep when nobody uses the site.
 * The 5-minute scheduler call does its jobs only once an hour and answers the other calls without the database;
 * jobs that did nothing write no history row; the Inbox stops checking when the tab is hidden or nobody uses it. */
const touched = vi.hoisted(() => ({ n: 0, inserts: 0, updates: 0 }));
vi.mock("@/lib/db", () => {
  const chain = (): unknown => new Proxy(() => {}, { get: (_t, p) => (p === "then" ? (r: (v: unknown) => void) => r([{ id: 1 }]) : chain()), apply: () => chain() });
  return {
    db: new Proxy({}, { get: (_t, p) => { touched.n++; if (p === "insert") touched.inserts++; if (p === "update") touched.updates++; return chain(); } }),
    schema: new Proxy({}, { get: () => ({}) }),
  };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => null }));
const ran = vi.hoisted(() => ({ jobs: 0 }));
vi.mock("@/lib/voicemail", () => ({ notifyStragglers: async () => (ran.jobs++, 0) }));
vi.mock("@/lib/inbox", () => ({ sendScheduledEmails: async () => (ran.jobs++, 0) }));

import { GET } from "@/app/api/cron/frequent/route";
import { dueNow } from "@/lib/cron-schedule";
import { isNoop, runJob } from "@/lib/jobs";

const at = (iso: string) => new Date(iso);

describe("the 5-minute scheduler call", () => {
  it("is due only in the first 5 minutes of every third hour (8 database wakes a day when idle; Abraham, 1:28 PM ET)", () => {
    expect(dueNow(at("2026-11-26T18:00:30Z"))).toBe(true);
    expect(dueNow(at("2026-11-26T21:04:59Z"))).toBe(true);
    for (const t of ["18:05", "19:00", "20:00", "20:59", "22:00"]) expect(dueNow(at(`2026-11-26T${t}:00Z`)), t).toBe(false);
    const calls = Array.from({ length: 288 }, (_, i) => new Date(Date.UTC(2026, 10, 26, 0, i * 5))); // a day of 5-minute calls
    expect(calls.filter((d) => dueNow(d)).length).toBe(8);
  });
  it("the five jobs are listed in plain words with their timing", async () => {
    const { TIMED_JOBS } = await import("@/lib/cron-schedule");
    expect(TIMED_JOBS.map((j) => j.name)).toEqual(["Release ended holds", "Voicemail alerts safety net", "Erase deleted voicemails after 30 days", "Held promotional texts", "Scheduled emails"]);
    for (const j of TIMED_JOBS) expect(j.every).toMatch(/^Every 3 hours/);
  });
  it("the two time-sensitive jobs also run while the system is in use, at most every 10 minutes, adding no wake-ups", async () => {
    const { runWhileAwake, resetWhileAwake } = await import("@/lib/cron-schedule");
    process.env.RUN_WHILE_AWAKE_TEST = "1";
    resetWhileAwake();
    ran.jobs = 0;
    await runWhileAwake();
    expect(ran.jobs).toBe(2); // both jobs ran (on a request that already uses the database)
    await runWhileAwake();
    expect(ran.jobs).toBe(2); // a second request within 10 minutes: nothing
    delete process.env.RUN_WHILE_AWAKE_TEST;
    for (const f of ["src/app/api/voice/[action]/route.ts", "src/app/admin/(app)/layout.tsx", "src/app/pay/[orderId]/page.tsx"]) expect(readFileSync(f, "utf8"), f).toContain("after(() => runWhileAwake()");
  });
  it("a call that is not due answers at once without touching the database", async () => {
    process.env.CRON_SECRET = "s";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-11-26T19:00:00Z")); // on the hour but not a third hour
    touched.n = 0;
    const r = await GET(new Request("https://x/api/cron/frequent", { headers: { authorization: "Bearer s" } }));
    expect(await r.json()).toMatchObject({ skipped: expect.stringContaining("not due") });
    expect(touched.n).toBe(0);
    vi.useRealTimers();
  });
  it("without the secret: refused, no database", async () => {
    touched.n = 0;
    expect((await GET(new Request("https://x/api/cron/frequent"))).status).toBe(401);
    expect(touched.n).toBe(0);
  });
});

describe("job history rows", () => {
  it("a job that did nothing writes no row; one that did something does", async () => {
    touched.inserts = 0;
    await runJob("x", async () => 0);
    await runJob("x", async () => ({ released: 0, sent: [] }));
    expect(touched.inserts).toBe(0);
    await runJob("x", async () => 2);
    expect(touched.inserts).toBe(1);
  });
  it("a failure is always recorded", async () => {
    touched.inserts = 0;
    await runJob("x", async () => { throw new Error("boom"); }, { tries: 1 });
    expect(touched.inserts).toBe(1);
  });
  it("what counts as nothing", () => {
    for (const v of [0, null, undefined, false, "", [], {}, { a: 0, b: [] }]) expect(isNoop(v), JSON.stringify(v)).toBe(true);
    for (const v of [1, "x", [1], { a: 1 }, true]) expect(isNoop(v), JSON.stringify(v)).toBe(false);
  });
});

describe("Admin polling and the scheduler setup", () => {
  it("the Inbox checks at most once a minute, only when in view and in use (stops after 20 idle minutes)", () => {
    const f = readFileSync("src/app/admin/(app)/inbox/RefreshMail.tsx", "utf8");
    expect(f).toContain('document.visibilityState === "visible"');
    expect(f).toContain("20 * 60_000");
    expect(f).toMatch(/}, 60_000\)/);
  });
  it("no other Admin page polls on a timer", () => {
    const { execSync } = require("node:child_process") as typeof import("node:child_process");
    const hits = execSync("grep -rln setInterval src || true", { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    expect(hits).toEqual(["src/app/admin/(app)/inbox/RefreshMail.tsx"]);
  });
  it("the Cloudflare scheduler file is set to every 3 hours for its next deploy", () => {
    expect(readFileSync("cloudflare/wrangler.scheduler.toml", "utf8")).toContain('crons = ["0 */3 * * *"]');
  });
});
