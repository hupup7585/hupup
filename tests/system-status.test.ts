import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham EE: "Not active yet" notes, the test-data check (read-only), and categorizing real statement lines. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ currentStaff: async () => ({ role: "owner", userId: null, name: "Owner", phone: "" }), requireOwner: async () => ({ role: "owner", userId: null }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { blockers, scanForTestData } from "@/lib/system-status";
import { categorizeLineAction } from "@/app/admin/(app)/bookkeeping/actions";

describe("Not active yet", () => {
  it("SMS, Sola, email code and recording show why they aren't running; each turns active when its step is done", async () => {
    const none = await blockers({});
    const by = Object.fromEntries(none.map((b) => [b.key, b]));
    expect(by.sms).toMatchObject({ active: false });
    expect(by.payments.reason).toContain("SOLA_PAYMENTSITE_NAME and SOLA_WEBHOOK_PIN");
    expect(by.email.active).toBe(false);
    expect(by.recording).toMatchObject({ active: false, reason: expect.stringContaining("Abraham approves") });
    const twilio = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "x", TWILIO_PHONE_NUMBER: "+18454157585" };
    expect((await blockers(twilio)).find((b) => b.key === "sms")!.reason).toContain("A2P 10DLC");
    expect((await blockers({ ...twilio, TWILIO_MESSAGING_SERVICE_SID: "MG1" })).find((b) => b.key === "sms")!.active).toBe(true);
    expect((await blockers({ SOLA_PAYMENTSITE_NAME: "a", SOLA_WEBHOOK_PIN: "b" })).find((b) => b.key === "payments")!.active).toBe(true);
    expect((await blockers({ RESEND_API_KEY: "re_x" })).find((b) => b.key === "email")!.active).toBe(true);
  });
  it("the notes show in Admin where the feature lives; System status is Owner only", () => {
    expect(readFileSync("src/app/admin/(app)/messages/page.tsx", "utf8")).toContain('<NotActive k="sms" />');
    expect(readFileSync("src/app/admin/(app)/bookkeeping/page.tsx", "utf8")).toContain('<NotActive k="payments" />');
    expect(readFileSync("src/app/admin/(app)/settings/page.tsx", "utf8")).toContain('<NotActive k="recording" />');
    expect(readFileSync("src/app/admin/(app)/status/page.tsx", "utf8")).toContain("await requireOwner()");
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('["/admin/status", Activity, "System status", O]');
  });
});

describe("test data check (read-only)", () => {
  it("finds 555-01xx numbers, example.com emails and non-Twilio call ids; leaves real-looking data alone", async () => {
    expect(await scanForTestData()).toEqual([]);
    const [fake] = await db.insert(schema.customers).values({ phone: "+18455550142", name: "Test" }).returning();
    await db.insert(schema.customers).values({ phone: "+18457771234", name: "Real" });
    await db.insert(schema.orders).values({ status: "HOLD", channel: "PHONE", customerId: fake.id, eventDate: "2026-12-01", pickupDate: "2026-12-02" });
    await db.insert(schema.callSessions).values([{ callSid: "CAjourney1", fromNumber: "+18457771234" }, { callSid: `CA${"a".repeat(32)}`, fromNumber: "+18457771234" }]);
    const found = await scanForTestData();
    const labels = Object.fromEntries(found.map((f) => [f.label, f.ids]));
    expect(labels["Customers with a 555-01xx test number"]).toEqual([fake.id]);
    expect(labels["Bookings for those test customers"]).toHaveLength(1);
    expect(labels["Calls that didn't come from Twilio (test call ids)"]).toEqual(["CAjourney1"]);
    expect(readFileSync("src/lib/system-status.ts", "utf8")).not.toMatch(/DELETE|UPDATE /);
  });
});

describe("real bank and card statements", () => {
  it("an unmatched line can be categorized into the books and is then matched", async () => {
    const [l] = await db.insert(schema.bookBankLines).values({ account: "card", lineDate: "2026-11-02", description: "SHELL OIL 1234", amountCents: -6150 }).returning();
    const f = new FormData();
    f.set("id", String(l.id));
    f.set("category", "Fuel and vehicle");
    await expect(categorizeLineAction(f)).rejects.toThrow(/msg=Added/);
    const [after] = await db.select().from(schema.bookBankLines).where(eq(schema.bookBankLines.id, l.id));
    expect(after.status).toBe("matched");
    const [e] = await db.select().from(schema.bookEntries).where(eq(schema.bookEntries.id, after.matchedEntryIds[0]));
    expect(e).toMatchObject({ kind: "expense", category: "Fuel and vehicle", amountCents: 6150, method: "card", entryDate: "2026-11-02" });
  });
});
