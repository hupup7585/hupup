import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * Gap review (Abraham, Nov 26, 2026, "build everything that needs no decision"): duplicate payment notices,
 * payment-callback and failed-send alerts, a tested backup restore, the last unit across channels, a price change
 * during an open cart, server-side guards on every Admin action, and no card data in logs.
 */
const h = vi.hoisted(() => ({ emails: [] as { to: string; subject: string; text: string }[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "test" }), cookies: async () => ({ get: () => undefined, set: () => {} }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { url: u }); } }));
vi.mock("@/lib/notify", async (orig) => ({
  ...(await orig<typeof import("@/lib/notify")>()),
  sendSms: async () => ({ sent: true }),
  sendEmail: async (to: string, subject: string, text: string) => (h.emails.push({ to, subject, text }), { sent: true }),
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { POST as solaWebhook } from "@/app/api/sola/webhook/route";
import { failedSendsReport, withCallbackAlert } from "@/lib/ops-alerts";
import { buildBackup, restoreBackup } from "@/lib/backup";
import { createOrderWithItems, refreshOrderTotals, reserveItem } from "@/lib/orders";

const PIN = "gap-pin";
const sign = (fields: Record<string, string>) => {
  const vals = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v).join("");
  return crypto.createHash("md5").update(vals + PIN).digest("hex");
};
const post = (fields: Record<string, string>) => solaWebhook(new Request("https://hupup.example/api/sola/webhook", { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "ck-signature": sign(fields) } }));
const order = async (id: number) => (await db.select().from(schema.orders).where(eq(schema.orders.id, id)))[0];
const approved = (invoice: string, ref: string, amount: string) => ({ xResult: "A", xStatus: "Approved", xCommand: "cc:sale", xInvoice: invoice, xRefNum: ref, xAuthAmount: amount, xMaskedCardNumber: "4xxxxxxxxxxx1111" });

let productId = 0;
beforeAll(async () => {
  process.env.PUBLIC_BASE_URL = "https://hupup.example";
  process.env.SOLA_WEBHOOK_PIN = PIN;
  process.env.ADMIN_EMAIL = "owner@example.test";
  const [c] = await db.insert(schema.categories).values({ name: "Jumping Balloons", ivrDigit: 1, sortOrder: 1, active: true }).returning();
  const [p] = await db.insert(schema.products).values({ categoryId: c.id, name: "Royal Castle", priceCents: 20000, quantity: 1, active: true }).returning();
  productId = p.id;
});
beforeEach(() => {
  h.emails.length = 0;
});

describe("payment notices", () => {
  it("the same payment sent again is counted once, even after another payment on the order came in between", async () => {
    const { invoiceFor } = await import("@/lib/sola");
    const [o] = await db.insert(schema.orders).values({ status: "PENDING_PAYMENT", channel: "POS", eventDate: "2027-02-01", pickupDate: "2027-02-02", subtotalCents: 10000, totalCents: 10000 }).returning();
    const inv = invoiceFor(o.id);
    expect((await post(approved(inv, "1001", "60.00"))).status).toBe(200);
    expect((await post(approved(inv, "1002", "40.00"))).status).toBe(200);
    expect((await order(o.id)).paidCents).toBe(10000);
    const again = await post(approved(inv, "1001", "60.00")); // Sola retries the first one
    expect(await again.text()).toBe("ok (already recorded)");
    expect((await order(o.id)).paidCents).toBe(10000);
    expect((await post(approved(inv, "1002", "40.00"))).status).toBe(200);
    expect((await order(o.id)).paidCents).toBe(10000);
  });
  it("an approved payment for an order that does not exist: the Owner is emailed, nothing is marked", async () => {
    const r = await post(approved("HU-999999", "2001", "50.00"));
    expect(r.status).toBe(404);
    expect(h.emails.map((e) => e.subject)).toEqual(["Hup Up Attractions: a Sola payment could not be matched to an order"]);
    expect(h.emails[0].to).toBe("owner@example.test");
    expect(h.emails[0].text).not.toMatch(/4xxx|1111/); // no card details in alerts
  });
  it("a payment notice that fails: the Owner is emailed and the provider gets a 500 so it sends it again", async () => {
    const r = await withCallbackAlert("Sola", async () => {
      throw new Error("database is busy");
    });
    expect(r.status).toBe(500);
    expect(h.emails[0].subject).toBe("Hup Up Attractions: a Sola payment notice failed");
    expect(h.emails[0].text).toContain("database is busy");
    const logged = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "ops.alert"));
    expect(logged.length).toBeGreaterThan(0);
  });
});

describe("failed texts and emails: the daily report", () => {
  it("nothing failed: no email", async () => {
    expect(await failedSendsReport(new Date("2027-01-10T12:00:00Z"))).toEqual({ texts: 0, emails: 0 });
    expect(h.emails).toHaveLength(0);
  });
  it("a failed text and a failed email in the last 24 hours: one email to the Owner, last 4 digits only, no message words", async () => {
    const now = new Date();
    await db.insert(schema.messages).values({ direction: "out", contactPhone: "+18455550123", body: "SECRET BODY", status: "failed", errorCode: "30007", createdAt: now } as never);
    await db.insert(schema.inboxReplies).values({ toAddress: "client@example.test", subject: "Your receipt", body: "x", sent: false, error: "Resend 500", kind: "auto", createdAt: now } as never);
    const r = await failedSendsReport(new Date(now.getTime() + 60_000));
    expect(r).toEqual({ texts: 1, emails: 1 });
    expect(h.emails).toHaveLength(1);
    expect(h.emails[0].subject).toBe("Hup Up Attractions: texts or emails failed to send");
    expect(h.emails[0].text).toContain("ending 0123");
    expect(h.emails[0].text).toContain("error 30007");
    expect(h.emails[0].text).not.toContain("+18455550123");
    expect(h.emails[0].text).not.toContain("SECRET BODY");
  });
  it("runs in the daily job", () => {
    expect(readFileSync("src/app/api/cron/release-holds/route.ts", "utf8")).toContain('runJob("Failed texts and emails report"');
  });
});

describe("backups: a tested restore", () => {
  it("a backup restores into an empty database with the same rows; a second restore changes nothing", async () => {
    await db.insert(schema.customers).values({ name: "Backup Test", phone: "+18455550144" });
    const b = await buildBackup();
    const { createMemoryDb } = await import("./helpers/memory-db");
    const fresh = await createMemoryDb();
    // a brand-new database: the test helper's starter rows are cleared first (the restore itself never deletes anything)
    const all = (await fresh.db.execute(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'` as never)).rows.map((x) => (x as { table_name: string }).table_name);
    for (let pass = 0; pass < 10; pass++) {
      for (const t of all) await fresh.db.execute(`DELETE FROM "${t}"` as never).catch(() => null); // linked rows clear on a later pass
    }
    const r = await restoreBackup(b.gz, fresh.db as never);
    const count = async (exec: { execute: typeof db.execute }, t: string) => Number(((await exec.execute(`SELECT count(*)::int AS n FROM "${t}"` as never)).rows[0] as { n: number }).n);
    for (const t of ["customers", "orders", "order_items", "products", "categories", "audit_log", "messages"]) {
      expect(r.restored[t], `${t}: ${r.skipped[t]}`).toBeDefined();
      expect(await count(fresh.db as never, t)).toBe(await count(db as never, t));
    }
    // the id counters moved past the restored rows: a new customer gets a new id
    const [next] = await fresh.db.insert(fresh.schema.customers).values({ name: "After restore", phone: "+18455550145" }).returning();
    const maxBefore = Math.max(...(await db.select().from(schema.customers)).map((c) => c.id));
    expect(next.id).toBeGreaterThan(maxBefore);
    // never overwrites: tables that already have rows are skipped
    const again = await restoreBackup(b.gz, fresh.db as never);
    expect(again.restored.customers).toBeUndefined();
    expect(again.skipped.customers).toMatch(/already has \d+ rows/);
  });
  it("the restore script exists and only fills empty tables", () => {
    const s = readFileSync("scripts/restore-backup.ts", "utf8");
    expect(s).toContain("restoreBackup");
    expect(readFileSync("src/lib/backup.ts", "utf8")).toContain("never overwrites or deletes");
  });
});

describe("stock and prices", () => {
  it("the last unit: the phone and the staff booking screen at the same moment, exactly one gets it", async () => {
    const date = "2027-03-08";
    const results = await Promise.all([
      reserveItem({ orderId: null, productId, qty: 1, eventDate: date, channel: "PHONE", holdExpiresAt: new Date(Date.now() + 600_000), callSid: "CAlast" }),
      createOrderWithItems({ items: [{ productId, qty: 1 }], eventDate: date, channel: "POS", status: "CONFIRMED" } as never),
    ]);
    expect(results.filter((r) => (r as { ok: boolean }).ok)).toHaveLength(1);
  });
  it("a catalog price change while a cart is open: the line keeps the price it was added at", async () => {
    const r = await reserveItem({ orderId: null, productId, qty: 1, eventDate: "2027-03-15", channel: "PHONE", holdExpiresAt: new Date(Date.now() + 600_000), callSid: "CAprice" });
    if (!r.ok) throw new Error("not reserved");
    await db.update(schema.products).set({ priceCents: 25000 }).where(eq(schema.products.id, productId));
    try {
      await refreshOrderTotals(r.orderId);
      const lines = await db.select().from(schema.orderItems).where(eq(schema.orderItems.orderId, r.orderId));
      expect(lines.map((l) => l.unitPriceCents)).toEqual([20000]);
      expect((await order(r.orderId)).subtotalCents).toBe(20000);
    } finally {
      await db.update(schema.products).set({ priceCents: 20000 }).where(eq(schema.products.id, productId));
    }
  });
});

describe("paying twice or with an old link", () => {
  it("a paid order: the pay page refuses another payment (refresh, back button or an old link), with nothing recorded", async () => {
    process.env.SOLA_PAYMENTSITE_NAME = "hupuptest";
    process.env.AUTH_SECRET ??= "test-secret-for-pay-links-0123456789";
    const { payToken } = await import("@/lib/rental-terms");
    const { agreeAndPayAction } = await import("@/app/pay/[orderId]/actions");
    const [o] = await db.insert(schema.orders).values({ status: "CONFIRMED", channel: "POS", eventDate: "2027-04-05", pickupDate: "2027-04-06", subtotalCents: 10000, totalCents: 10000, paidCents: 10000 }).returning();
    const r = await agreeAndPayAction(o.id, payToken(o.id), true).catch((e: { url?: string }) => ({ redirected: e.url }));
    expect(r).toMatchObject({ error: expect.stringMatching(/not waiting for payment|Nothing left to pay|not ready for payment/) });
    expect((await db.select().from(schema.termsAcceptances).where(eq(schema.termsAcceptances.orderId, o.id)))).toHaveLength(0);
    expect(await agreeAndPayAction(o.id, "old-or-wrong-token", true)).toEqual({ error: "This payment link is not valid. Please call us." });
  });
  it("the pay button cannot be pressed twice while it is sending", () => {
    expect(readFileSync("src/app/pay/[orderId]/PayForm.tsx", "utf8")).toContain("disabled={!agreed || pending}");
  });
});

/** Every file under a folder. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("server-side guards", () => {
  const GUARD = /require(Owner|Admin|Staff|Books)\(|currentStaff\(|bridgeKeyOk\(|setOwnPassword\(/;
  it("every Admin server action checks who is signed in (Delivery and Secretary are turned away from Owner-only ones)", () => {
    const missing: string[] = [];
    for (const f of files("src/app/admin").filter((p) => /\.tsx?$/.test(p))) {
      const s = readFileSync(f, "utf8");
      if (!s.slice(0, 200).includes('"use server"') || f.includes(`${join("admin", "login")}`)) continue; // sign-in is public by design
      // local helpers that check (run, who, ...) count as checks for the actions that call them
      const defs = [...s.matchAll(/^(?:async )?function (\w+)[\s\S]*?^\}/gm)].map((m) => ({ name: m[1], body: m[0] }));
      const helpers: string[] = [];
      for (let grew = true; grew; ) {
        grew = false;
        for (const d of defs) {
          if (helpers.includes(d.name)) continue;
          if (GUARD.test(d.body) || helpers.some((x) => new RegExp(`\\b${x}\\(`).test(d.body.slice(d.body.indexOf("{"))))) {
            helpers.push(d.name);
            grew = true;
          }
        }
      }
      const ok = new RegExp(`${GUARD.source}|\\b(${helpers.join("|") || "__none__"})\\(`);
      for (const part of s.split(/(?=export async function )/).slice(1)) {
        const name = /export async function (\w+)/.exec(part)![1];
        if (name === "methodsList") continue; // returns a fixed list, no data
        if (!ok.test(part)) missing.push(`${f}: ${name}`);
      }
    }
    expect(missing, missing.join("\n")).toEqual([]);
  });
  it("every Admin API route checks a staff session or the admin API key", () => {
    const missing = files("src/app/api/admin").filter((p) => p.endsWith("route.ts") && !GUARD.test(readFileSync(p, "utf8")));
    expect(missing).toEqual([]);
  });
  it("money and Owner pages are Owner-only (or the books permission) on the server", () => {
    for (const page of ["bookkeeping", "keys", "settings", "staff", "status", "offers", "discounts", "hours", "campaigns"]) {
      const s = readFileSync(`src/app/admin/(app)/${page}/page.tsx`, "utf8");
      expect(s, page).toMatch(/requireOwner\(|requireBooks\(|requireStaff\(\["owner"/);
    }
    const auth = readFileSync("src/lib/auth.ts", "utf8");
    expect(auth).toMatch(/if \(s\.role === "delivery"\) redirect\("\/admin\/deliveries"\)/); // Delivery never reaches booking or money pages
    expect(auth).toMatch(/if \(s\.role !== "owner"\) redirect\(homeFor\(s\.role\)\)/); // Owner-only
  });
});

describe("no card data in logs", () => {
  it("payment code never logs the raw notice, its fields, or card numbers", () => {
    const paymentFiles = [...files("src/app/api/sola"), ...files("src/app/api/stripe"), ...files("src/app/api/pay-voice"), "src/lib/sola.ts", "src/lib/sola-phonepay.ts", "src/lib/stripe.ts", "src/lib/stripe-ops.ts", "src/lib/payment-result.ts"].filter((p) => /\.tsx?$/.test(p));
    for (const f of paymentFiles) {
      for (const line of readFileSync(f, "utf8").split("\n").filter((l) => /console\.(log|error|warn|info)\(/.test(l))) {
        expect(line.replace(/field\(fields, "x(Invoice|RefNum)"\)/g, ""), f).not.toMatch(/\b(raw|fields|payload|body|xCardNum|cardNumber|xMaskedCardNumber|xCVV|xExp)\b(?!["'])/);
      }
    }
  });
});
