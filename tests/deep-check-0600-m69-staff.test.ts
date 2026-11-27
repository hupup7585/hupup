import { describe, expect, it, vi } from "vitest";

/* Deep check 0600 M69 (B3 leftover, Nov 27, 2026): the same Google account saved on two staff members at the same
   moment gives a plain answer, never an error page. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), requireOwner: async () => ({ userId: null, role: "owner" }) }));

import { db, schema } from "@/lib/db";
import { setGoogleEmailAction } from "@/app/admin/(app)/staff/actions";

describe("Google account on two staff at once", () => {
  it("one is saved; the other gets the plain message", async () => {
    const [a, b] = await db.insert(schema.adminUsers).values([{ name: "Sara", phone: "+18455550501", role: "secretary" }, { name: "Leah", phone: "+18455550502", role: "secretary" }]).returning();
    const r = await Promise.all([setGoogleEmailAction(a.id, "office.helper@gmail.com"), setGoogleEmailAction(b.id, "office.helper@gmail.com")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
    expect(r.find((x) => !x.ok)?.message).toBe("That Google account is already saved on another staff member.");
  });
});
