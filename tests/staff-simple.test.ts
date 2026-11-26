import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* The simple Staff page (Abraham, Nov 26, 2026, 4:07 PM): one Edit form with one Save; every problem said in plain
 * words; no silently greyed-out buttons; the Owner's username box is never filled in by the browser. */
const h = vi.hoisted(() => ({ me: { userId: 1, role: "owner" } }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async () => ({
  requireOwner: async () => h.me,
  revokeSessions: async () => undefined,
  hashPassword: async (p: string) => {
    if (p.length < 10) throw new Error("Use at least 10 characters.");
    return `hash:${p.length}`;
  },
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createStaffAction, saveStaffAction } from "@/app/admin/(app)/staff/actions";

let sara = 0;
beforeAll(async () => {
  const [me] = await db.insert(schema.adminUsers).values({ name: "Abraham", phone: "+18457777585", role: "owner" }).returning();
  h.me.userId = me.id;
  const r = await createStaffAction({ name: "Sara", phone: "845-415-0001", role: "secretary" });
  expect(r.ok).toBe(true);
  sara = (await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.phone, "+18454150001")))[0].id;
});
const base = () => ({ name: "Sara", phone: "8454150001", role: "secretary" as const, username: "", password: "", googleEmail: "" });

describe("one Save, every check in plain words", () => {
  it("saves name, number, role, username, password and Google email together", async () => {
    const r = await saveStaffAction(sara, { ...base(), name: "Sara K", username: "sara", password: "a-long-password", googleEmail: "sara@gmail.com" });
    expect(r).toMatchObject({ ok: true });
    const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, sara));
    expect(u).toMatchObject({ name: "Sara K", username: "sara", googleEmail: "sara@gmail.com", passwordHash: "hash:15" });
  });
  it("an empty password keeps the current one", async () => {
    await saveStaffAction(sara, { ...base(), name: "Sara K", username: "sara", googleEmail: "sara@gmail.com" });
    expect((await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, sara)))[0].passwordHash).toBe("hash:15");
  });
  it.each([
    [{ name: "" }, "Type the person's name first."],
    [{ phone: "12" }, "Type a 10-digit mobile number first"],
    [{ password: "short" }, "Type a password of at least 10 characters"],
    [{ role: "delivery" as const, password: "a-long-password" }, "Delivery accounts sign in with a texted code only"],
    [{ phone: "845-777-7585" }, "That mobile number already belongs to another account."],
  ])("refuses %o with a plain reason", async (patch, words) => {
    const r = await saveStaffAction(sara, { ...base(), ...patch });
    expect(r.ok).toBe(false);
    expect(r.message).toContain(words);
  });
  it("the Owner cannot take away their own Owner role", async () => {
    const r = await saveStaffAction(h.me.userId, { name: "Abraham", phone: "8457777585", role: "secretary", username: "", password: "", googleEmail: "" });
    expect(r).toEqual({ ok: false, message: "You cannot take away your own Owner role." });
  });
  it("adding a person checks the same way", async () => {
    expect((await createStaffAction({ name: "", phone: "8454150002", role: "secretary" })).message).toBe("Type the person's name first.");
    expect((await createStaffAction({ name: "Moshe", phone: "8454150002", role: "secretary", password: "short" })).message).toContain("at least 10 characters");
  });
});

describe("the page", () => {
  const simple = readFileSync("src/app/admin/(app)/staff/SimpleStaff.tsx", "utf8");
  it("one row per person with one Edit button; Deactivate is separate and asks Are you sure", () => {
    expect(simple).toContain("data-staff-edit={u.id}");
    expect(simple).toContain("Are you sure?");
    expect(simple).toContain("data-staff-active={u.id}");
  });
  it("one form with every field, plain-English help under each, one Save", () => {
    for (const f of ['name="staff-name"', 'name="staff-phone"', 'name="staff-role"', 'name="staff-username"', 'name="staff-new-password"', 'name="staff-google"']) expect(simple).toContain(f);
    expect(simple.match(/<Help>/g)!.length).toBeGreaterThanOrEqual(6);
    expect(simple).toContain("data-staff-save");
  });
  it("no button is ever disabled; the browser never fills in the username boxes", () => {
    expect(simple).not.toMatch(/disabled=/);
    const old = readFileSync("src/app/admin/(app)/staff/StaffForms.tsx", "utf8");
    expect(old).not.toContain("disabled={pending || !pw}");
    expect(old).toContain('name="owner-sign-in-name" autoComplete="off"');
    expect(simple).toContain('autoComplete="off"');
  });
});
