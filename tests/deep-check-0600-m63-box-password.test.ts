import { describe, expect, it, vi } from "vitest";

/* Deep check 06:00 M63: the Owner can set or reset a staff voicemail box password in Admin. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireOwner: async () => ({ userId: null, role: "owner", name: "Owner", phone: "+18457777585" }) }));

import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { setBoxPasswordAction } from "@/app/admin/(app)/voicemail/actions";

const form = (pin: string) => {
  const f = new FormData();
  f.set("pin", pin);
  return f;
};

describe("deep check 06:00 M63: box password in Admin", () => {
  it("sets a new password (hashed), clears the lock; a bad one changes nothing; the form is on the page", async () => {
    const [box] = await db.insert(schema.voicemailBoxes).values({ name: "Leah's box", boxNumber: "701", wrongTries: 2, lockedUntil: new Date(Date.now() + 600_000) }).returning();
    await setBoxPasswordAction(box.id, form("12"));
    let [b] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.id, box.id));
    expect(b.pinHash).toBeNull();
    await setBoxPasswordAction(box.id, form("482913"));
    [b] = await db.select().from(schema.voicemailBoxes).where(eq(schema.voicemailBoxes.id, box.id));
    expect(await bcrypt.compare("482913", b.pinHash!)).toBe(true);
    expect([b.wrongTries, b.lockedUntil]).toEqual([0, null]);
    const log = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "voicemail_box.password_set"));
    expect(JSON.stringify(log)).not.toContain("482913");
    expect(readFileSync("src/app/admin/(app)/voicemail/page.tsx", "utf8")).toContain("setBoxPasswordAction.bind(null, b.id)");
  });
});
