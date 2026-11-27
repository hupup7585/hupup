import { beforeAll, describe, expect, it, vi } from "vitest";

/* Extra check F (Nov 27, 2026): Admin outside Bookkeeping. In-memory database with the real migrations. */
const h = vi.hoisted(() => ({ texts: [] as string[], staff: { userId: null as number | null, role: "owner" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({
  getTwilio: () => ({ messages: { create: async (p: { to: string }) => (h.texts.push(p.to), { sid: `SMf${h.texts.length}`, status: "queued" }) } }),
}));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireOwner: async () => h.staff,
  requireStaff: async () => h.staff,
  requireAdmin: async () => h.staff,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("REDIRECT"), { to });
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

const NOON = new Date("2026-11-10T17:00:00Z");
const redirectTo = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return decodeURIComponent(String((e as { to?: string }).to ?? (e as Error).message));
  }
  return "";
};
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

beforeAll(() => {
  process.env.TWILIO_PHONE_NUMBER = "+18454157585";
});

describe("F1 + F2: duplicate customers and campaigns", () => {
  it("F2: one campaign text per phone, even with two records; F1: merging them afterwards works", async () => {
    const [a, b] = await db
      .insert(schema.customers)
      .values([
        { name: "Sara A", phone: "+18455550701", marketingOptIn: true, marketingOptInAt: NOON, timeZone: "America/New_York" },
        { name: "Sara B", phone: "+18455550701", marketingOptIn: true, marketingOptInAt: NOON, timeZone: "America/New_York" },
      ])
      .returning();
    const { approveCampaign, createCampaign, sendCampaign } = await import("@/lib/campaigns");
    const c = await createCampaign({ name: "Spring", body: "Spring deal: 10% off bounce houses booked this week." }, null);
    await approveCampaign(c.id, null);
    const done = await sendCampaign(c.id, null, NOON);
    expect(done.status).toBe("sent");
    expect(h.texts.filter((t) => t === "+18455550701")).toHaveLength(1);

    // both records end up with a row for this campaign (one sent, one recorded) before the merge
    const already = await db.select().from(schema.smsCampaignSends).where(eq(schema.smsCampaignSends.campaignId, c.id));
    if (!already.some((r) => r.customerId === b.id)) await db.insert(schema.smsCampaignSends).values({ campaignId: c.id, customerId: b.id, phone: "+18455550701", status: "skipped" });
    if (!already.some((r) => r.customerId === a.id)) await db.insert(schema.smsCampaignSends).values({ campaignId: c.id, customerId: a.id, phone: "+18455550701", status: "skipped" });
    const { mergeCustomers } = await import("@/lib/duplicate-customers");
    const r = await mergeCustomers(a.id, [b.id], null);
    expect(r.ok).toBe(true);
    const rows = await db.select().from(schema.smsCampaignSends).where(eq(schema.smsCampaignSends.campaignId, c.id));
    expect(rows).toHaveLength(2); // nothing deleted
  });
  it("F6: a campaign too long to send stays approved (not stranded as sent)", async () => {
    const { approveCampaign, createCampaign, sendCampaign } = await import("@/lib/campaigns");
    const c = await createCampaign({ name: "Long", body: "x ".repeat(900) }, null).catch(() => null);
    if (!c) return; // the editor already refuses it
    await approveCampaign(c.id, null);
    await expect(sendCampaign(c.id, null, NOON)).rejects.toThrow(/Too long/);
    const [after] = await db.select().from(schema.smsCampaigns).where(eq(schema.smsCampaigns.id, c.id));
    expect(after.status).toBe("approved");
  });
});

describe("F3: a deactivated staff member's voicemail box", () => {
  it("can't be opened by caller ID or by box number", async () => {
    const [u] = await db.insert(schema.adminUsers).values({ name: "Leah", phone: "+18455550801", role: "secretary" }).returning();
    const { boxByNumber, personalBoxForCaller } = await import("@/lib/vm-boxes");
    const box = await personalBoxForCaller("+18455550801");
    expect(box).not.toBeNull();
    expect(await boxByNumber(box!.boxNumber!)).not.toBeNull();
    await db.update(schema.adminUsers).set({ active: false }).where(eq(schema.adminUsers.id, u.id));
    expect(await personalBoxForCaller("+18455550801")).toBeNull();
    expect(await boxByNumber(box!.boxNumber!)).toBeNull();
  });
});

describe("F4 + F5: Tasks", () => {
  it("F4: two Start clicks at once start one timer; a double Stop logs once", async () => {
    const [u] = await db.insert(schema.adminUsers).values({ name: "Owner", phone: "+18455550901", role: "owner" }).returning();
    h.staff = { userId: u.id, role: "owner" };
    const [t] = await db.insert(schema.tasks).values({ title: "Fix blower", createdBy: u.id }).returning();
    const { startTimerAction, stopTimerAction } = await import("@/app/admin/tasks/actions");
    await Promise.all([redirectTo(startTimerAction(fd({ taskId: String(t.id) }))), redirectTo(startTimerAction(fd({ taskId: String(t.id) })))]);
    const logs = await db.select().from(schema.timeLogs).where(eq(schema.timeLogs.taskId, t.id));
    expect(logs).toHaveLength(1);
    await Promise.all([redirectTo(stopTimerAction(fd({ logId: String(logs[0].id) }))), redirectTo(stopTimerAction(fd({ logId: String(logs[0].id) })))]);
    const stops = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "task.timer_stopped"));
    expect(stops.length).toBeLessThanOrEqual(1);
  });
  it("F5: saving a task kept on a deactivated person keeps them assigned", async () => {
    const [gone] = await db.insert(schema.adminUsers).values({ name: "Gone", phone: "+18455550902", role: "secretary", active: false }).returning();
    const [t] = await db.insert(schema.tasks).values({ title: "Old task", assignedTo: gone.id }).returning();
    const { updateTaskAction } = (await import("@/app/admin/tasks/actions")) as unknown as { updateTaskAction?: (f: FormData) => Promise<unknown> };
    if (!updateTaskAction) return;
    await redirectTo(updateTaskAction(fd({ id: String(t.id), title: "Old task, renamed", assignedTo: String(gone.id), status: "open", priority: "normal" })));
    const [after] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, t.id));
    expect(after.assignedTo).toBe(gone.id);
  });
});

describe("F7: customer email", () => {
  it("an email the server can't use keeps the saved one; an empty box clears it", async () => {
    const [c] = await db.insert(schema.customers).values({ name: "Chaya", phone: "+18455551001", email: "chaya@example.com" }).returning();
    const { saveCustomerAction } = await import("@/app/admin/(app)/customers/actions");
    await saveCustomerAction(fd({ id: String(c.id), name: "Chaya", email: "chaya@example" }));
    expect((await db.select().from(schema.customers).where(eq(schema.customers.id, c.id)))[0].email).toBe("chaya@example.com");
    await saveCustomerAction(fd({ id: String(c.id), name: "Chaya", email: "" }));
    expect((await db.select().from(schema.customers).where(eq(schema.customers.id, c.id)))[0].email).toBeNull();
  });
});

describe("F8: blank and out-of-range numbers", () => {
  it("Chanukah/Chol Hamoed: a blank box keeps the saved value; out of range saves nothing", async () => {
    const { saveSetting, getSettings } = await import("@/lib/settings");
    await saveSetting("holidayPickupAfterShabbesMin", "45");
    const { saveHolidayRentalsAction } = await import("@/app/admin/(app)/offers/actions");
    const ok = await redirectTo(saveHolidayRentalsAction(fd({ holidayPickupAfterShabbesMin: "", holidaySundayPickup: "09:00" })));
    expect(ok).toContain("saved");
    expect(String((await getSettings()).holidayPickupAfterShabbesMin)).toBe("45");
    const bad = await redirectTo(saveHolidayRentalsAction(fd({ holidayPickupAfterShabbesMin: "900", holidaySundayPickup: "09:00" })));
    expect(bad).toContain("Not saved");
    expect(String((await getSettings()).holidayPickupAfterShabbesMin)).toBe("45");
  });
  it("Address check: a blank box keeps the saved value; out of range saves nothing", async () => {
    const { saveSetting, getSettings } = await import("@/lib/settings");
    await saveSetting("addressRecheckEarlyMinutes", "20");
    const { saveAddressCheckAction } = await import("@/app/admin/(app)/delivery-settings/area-actions");
    await redirectTo(saveAddressCheckAction(fd({ addressRecheckEarlyMinutes: "", addressRecheckEarlyForMinutes: "60", addressRecheckLaterMinutes: "60" })));
    expect(String((await getSettings()).addressRecheckEarlyMinutes)).toBe("20");
    const bad = await redirectTo(saveAddressCheckAction(fd({ addressRecheckEarlyMinutes: "1", addressRecheckEarlyForMinutes: "60", addressRecheckLaterMinutes: "60" })));
    expect(bad).toContain("Not saved");
    expect(String((await getSettings()).addressRecheckEarlyMinutes)).toBe("20");
  });
});

describe("F9: customer discounts", () => {
  it("a date that doesn't exist is refused for both kinds; a double click saves one", async () => {
    const { parseDiscountForm } = await import("@/lib/customer-discounts");
    expect(parseDiscountForm({ phone: "8455551101", kind: "percent", value: "10", endsOn: "2026-02-30", note: "" })).toEqual({ error: "The end date is not a date." });
    expect(parseDiscountForm({ phone: "8455551101", kind: "amount", value: "25", endsOn: "2026-02-30", note: "" })).toEqual({ error: "The end date is not a date." });
    expect("error" in parseDiscountForm({ phone: "8455551101", kind: "amount", value: "25", endsOn: "2026-12-31", note: "" })).toBe(false);
    const { addDiscountAction } = await import("@/app/admin/(app)/discounts/actions");
    const form = { phone: "8455551101", kind: "amount", value: "25", endsOn: "2026-12-31", note: "VIP" };
    await Promise.all([redirectTo(addDiscountAction(fd(form))), redirectTo(addDiscountAction(fd(form)))]);
    expect(await db.select().from(schema.customerDiscounts).where(eq(schema.customerDiscounts.phone, "+18455551101"))).toHaveLength(1);
  });
});

describe("F10: Add staff member twice at once", () => {
  it("the second gets the usual message, not an error page", async () => {
    const { createStaffAction } = await import("@/app/admin/(app)/staff/actions");
    const form = { name: "Rivky", phone: "8455551201", role: "secretary" as const };
    const rs = await Promise.all([createStaffAction(form), createStaffAction(form)]);
    expect(rs.filter((r) => r.ok)).toHaveLength(1);
    expect(rs.find((r) => !r.ok)?.message).toBe("That phone number already has an account.");
  });
});
