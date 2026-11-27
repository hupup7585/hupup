import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Deep check 0600 M63: the Owner sets or resets a personal voicemail box password in Admin. */
const h = vi.hoisted(() => ({ owner: { userId: 1, role: "owner", name: "Abraham" }, allow: true }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", () => ({
  requireOwner: async () => {
    if (!h.allow) throw new Error("REDIRECT /admin/login");
    return h.owner;
  },
  requireStaff: async () => h.owner,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error(`REDIRECT ${u}`); } }));
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { setBoxPinAction } from "@/app/admin/(app)/voicemail/actions";
import { checkBoxPin, ensurePersonalBoxes, getBox } from "@/lib/vm-boxes";
import { trustedMsg } from "@/lib/url-message";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, x] of Object.entries(v)) f.set(k, x);
  return f;
};
const message = async (p: Promise<unknown>) => {
  const e = (await p.then(() => null, (x: Error) => x)) as Error;
  const u = new URL(e.message.replace("REDIRECT ", ""), "https://x");
  return trustedMsg(u.searchParams.get("m"), u.searchParams.get("ms"));
};

describe("M63: Owner sets a box password in Admin", () => {
  it("sets it (hash only), unlocks the box, and the old default no longer opens it", async () => {
    await db.insert(schema.adminUsers).values({ name: "Abraham", role: "owner", phone: "+18455550991" });
    const [box] = await ensurePersonalBoxes();
    await db.update(schema.voicemailBoxes).set({ wrongTries: 3, lockedUntil: new Date(Date.now() + 15 * 60_000) }).where(eq(schema.voicemailBoxes.id, box.id));
    expect(await message(setBoxPinAction(form({ boxId: String(box.id), pin: "48213", pinAgain: "48213" })))).toMatch(/^Saved:.*unlocked/);
    const after = (await getBox(box.id))!;
    expect(after.pinHash).toBeTruthy();
    expect(after.pinHash).not.toContain("48213");
    expect(after.lockedUntil).toBeNull();
    expect(await checkBoxPin(after, "48213")).toBe("ok");
    expect(await checkBoxPin((await getBox(box.id))!, "1234")).toBe("wrong");
    const [log] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "voicemail_box.password_set"));
    expect(JSON.stringify(log.after)).not.toContain("48213");
  });
  it("refuses a short password, two different ones, or a box that isn't a personal box; nothing changes", async () => {
    const [box] = await ensurePersonalBoxes();
    const before = (await getBox(box.id))!.pinHash;
    expect(await message(setBoxPinAction(form({ boxId: String(box.id), pin: "12", pinAgain: "12" })))).toMatch(/^Not saved: a password is 4 to 8 digits/);
    expect(await message(setBoxPinAction(form({ boxId: String(box.id), pin: "5555", pinAgain: "5556" })))).toMatch(/^Not saved: the two passwords/);
    const [main] = await db.insert(schema.voicemailBoxes).values({ name: "Main", isMain: true }).returning();
    expect(await message(setBoxPinAction(form({ boxId: String(main.id), pin: "5555", pinAgain: "5555" })))).toMatch(/^Not saved: choose a box/);
    expect(await message(setBoxPinAction(form({ boxId: "abc", pin: "5555", pinAgain: "5555" })))).toMatch(/^Not saved: choose a box/);
    expect((await getBox(box.id))!.pinHash).toBe(before);
  });
  it("Owner only; the form is on the Owner part of the Voicemail page", async () => {
    h.allow = false;
    await expect(setBoxPinAction(form({ boxId: "1", pin: "5555", pinAgain: "5555" }))).rejects.toThrow(/login/);
    h.allow = true;
    const page = readFileSync("src/app/admin/(app)/voicemail/page.tsx", "utf8");
    expect(page).toContain("action={setBoxPinAction}");
    expect(page.indexOf("action={setBoxPinAction}")).toBeGreaterThan(page.indexOf("{access && ("));
  });
});
