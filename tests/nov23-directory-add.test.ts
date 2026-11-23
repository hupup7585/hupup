import { describe, expect, it, vi } from "vitest";

/* Directory list (Abraham, Nov 23, 2026): its own side-menu entry (Owner only) and Add a name. In-memory database. */
const h = vi.hoisted(() => ({ role: "owner" as "owner" | "secretary" }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireOwner: async () => {
    if (h.role !== "owner") throw new Error("NEXT_REDIRECT");
    return { userId: 1, role: "owner" };
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { isActive, navFor } from "@/components/Sidebar";
import { addDirectoryNameAction, lookupDirectoryPhoneAction, removeDirectoryNameAction } from "@/app/admin/(app)/customers/directory/actions";
import { isSharedNumber } from "@/lib/shared-phones";
import { lookupByPhone } from "@/lib/directory";

const hrefs = (role: "owner" | "secretary" | "delivery") => navFor(role).flatMap((g) => g.items.map(([href, , label]) => `${label} ${href}`));
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const TEST = { lastName: "Testentry", firstName: "Hark", phone: "(845) 555-0177", house: "10", street: "D A WIEDER BLVD", unit: "", town: "Monroe", zip: "10950" };

describe("side menu", () => {
  it("Owner sees Directory list right under Customers; Secretary and Delivery do not", () => {
    const owner = hrefs("owner");
    expect(owner[owner.indexOf("Customers /admin/customers") + 1]).toBe("Directory list /admin/customers/directory");
    expect(hrefs("secretary").some((x) => x.includes("Directory"))).toBe(false);
    expect(hrefs("delivery").some((x) => x.includes("Directory"))).toBe(false);
    // On the directory page only Directory list is marked, not Customers
    expect(isActive("/admin/customers/directory", "/admin/customers/directory")).toBe(true);
    expect(isActive("/admin/customers/directory", "/admin/customers")).toBe(false);
    expect(isActive("/admin/customers/12", "/admin/customers")).toBe(true);
  });
});

describe("Add a name", () => {
  it("saves into the directory; the phone lookup finds it right away; removing it works", async () => {
    expect(await addDirectoryNameAction(form(TEST))).toEqual({ ok: true, message: "Saved" });
    const found = await lookupDirectoryPhoneAction("845-555-0177");
    expect(found.found).toEqual(["Testentry, Hark | 10 D A WIEDER BLVD | Monroe, NY 10950"]);
    const [row] = await lookupByPhone("+18455550177");
    expect(await isSharedNumber("+18455550177")).toBe(false);

    // the same number again: a warning first, nothing saved
    const again = await addDirectoryNameAction(form({ ...TEST, firstName: "Sara", house: "12" }));
    expect(again.ok).toBe(false);
    expect(again.sharedWith).toEqual(["Testentry, Hark (10 D A WIEDER BLVD, Monroe)"]);
    expect(await lookupByPhone("+18455550177")).toHaveLength(1);
    // Save anyway: now a shared number (the shared-number owner alert rule)
    expect((await addDirectoryNameAction(form({ ...TEST, firstName: "Sara", house: "12" }), true)).ok).toBe(true);
    expect(await isSharedNumber("+18455550177")).toBe(true);

    for (const r of await lookupByPhone("+18455550177")) expect((await removeDirectoryNameAction(r.id)).ok).toBe(true);
    expect(await lookupByPhone("+18455550177")).toHaveLength(0);
    expect(row.state).toBe("NY");
  });

  it("checks the fields: names, 10-digit phone (optional), house, a street from the list, town, zip", async () => {
    expect((await addDirectoryNameAction(form({ ...TEST, lastName: "" }))).message).toBe("Enter the last name and first name.");
    expect((await addDirectoryNameAction(form({ ...TEST, phone: "555-0177" }))).message).toBe("The phone number must be 10 digits, or leave it empty.");
    expect((await addDirectoryNameAction(form({ ...TEST, street: "Made Up Street" }))).message).toBe("Pick the street from the list.");
    expect((await addDirectoryNameAction(form({ ...TEST, zip: "109" }))).message).toBe("The zip code must be 5 digits.");
    const noPhone = await addDirectoryNameAction(form({ ...TEST, phone: "", unit: "001A" }));
    expect(noPhone.ok).toBe(true);
  });

  it("Owner only", async () => {
    h.role = "secretary";
    await expect(addDirectoryNameAction(form(TEST))).rejects.toThrow();
    await expect(lookupDirectoryPhoneAction("8455550177")).rejects.toThrow();
    await expect(removeDirectoryNameAction(1)).rejects.toThrow();
    h.role = "owner";
  });
});
