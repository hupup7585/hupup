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

import { GET } from "@/app/api/cron/frequent/route";
import { dueNow } from "@/lib/cron-schedule";
import { isNoop, runJob } from "@/lib/jobs";

const at = (iso: string) => new Date(iso);

describe("the 5-minute scheduler call", () => {
  it("is due only in the first 5 minutes of each hour (one database wake an hour)", () => {
    expect(dueNow(at("2026-11-26T18:00:30Z"))).toBe(true);
    expect(dueNow(at("2026-11-26T18:04:59Z"))).toBe(true);
    for (const m of ["05", "10", "15", "30", "45", "55"]) expect(dueNow(at(`2026-11-26T18:${m}:00Z`)), m).toBe(false);
    const calls = Array.from({ length: 288 }, (_, i) => new Date(Date.UTC(2026, 10, 26, 0, i * 5))); // a day of 5-minute calls
    expect(calls.filter((d) => dueNow(d)).length).toBe(24);
  });
  it("a call that is not due answers at once without touching the database", async () => {
    process.env.CRON_SECRET = "s";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at("2026-11-26T18:20:00Z"));
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
  it("the Cloudflare scheduler file is set to hourly for its next deploy", () => {
    expect(readFileSync("cloudflare/wrangler.scheduler.toml", "utf8")).toContain('crons = ["0 * * * *"]');
  });
});
