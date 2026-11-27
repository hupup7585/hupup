import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Free Cloudflare scheduler (Abraham, Nov 15, 2026): Workers only, no R2 and no DNS. Neon free plan (Nov 26, 2026):
 * the jobs run once an hour (tests/neon-idle.test.ts); ?all=1 runs them now. No database is used here (M12). */
vi.mock("@/lib/orders", () => ({ releaseExpired: async () => 2 }));
vi.mock("@/lib/voicemail", () => ({ notifyStragglers: async () => 0 }));
vi.mock("@/lib/sms", () => ({ processHeldPromotions: async () => ({ sent: 0, canceled: 0, rescheduled: 0 }) }));
vi.mock("@/lib/jobs", () => ({ runJob: async (_n: string, f: () => Promise<unknown>) => ({ ok: true, result: await f() }) }));
vi.mock("@/lib/vm-boxes", () => ({ purgeOldDeleted: async () => 0 }));
vi.mock("@/lib/inbox", () => ({ sendScheduledEmails: async () => 0 }));
vi.mock("@/lib/address-checks", () => ({ recheckDue: async () => false, runAddressChecks: async () => ({ checked: 0 }) }));
vi.mock("@/lib/wake-flags", () => ({ wakeDue: async () => false }));

describe("the short jobs", () => {
  it("refuses without the secret; runs the short jobs with it", async () => {
    process.env.CRON_SECRET = "cron-test-secret";
    const { GET } = await import("@/app/api/cron/frequent/route");
    expect((await GET(new Request("http://x/api/cron/frequent"))).status).toBe(401);
    expect((await GET(new Request("http://x/api/cron/frequent", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    const r = await GET(new Request("http://x/api/cron/frequent?all=1", { headers: { authorization: "Bearer cron-test-secret" } }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ released: { ok: true, result: 2 } });
  });
  it("the Worker runs every 5 minutes (as each live build sets it), Workers only: no storage of its own, no routes on the domain", () => {
    const toml = readFileSync("cloudflare/wrangler.scheduler.toml", "utf8");
    expect(toml).toContain('crons = ["*/5 * * * *"]'); // deep check 06:00 M60
    expect(toml).not.toMatch(/r2_buckets|kv_namespaces|d1_databases|^\s*routes?\s*=/m);
    const worker = readFileSync("cloudflare/scheduler-worker.js", "utf8");
    expect(worker).toContain("/api/cron/frequent");
    expect(worker).toContain("Bearer ${env.CRON_SECRET}");
    expect(worker).not.toMatch(/env\.R2|\.put\(/);
  });
});
