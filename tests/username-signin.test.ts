import { describe, expect, it, vi } from "vitest";

/* Sign-in by username, phone number or email (Abraham, Nov 14, 2026); the page tells a stranger nothing. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => {} }) }));

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { loginPhoneFor } from "@/lib/auth";

describe("one Username field", () => {
  it("finds the account by username (any case), phone number or saved address; anything else passes through unchanged", async () => {
    await db.insert(schema.adminUsers).values({ name: "Sara", role: "secretary", phone: "+18455550301", username: "sara", email: "sara@example.com" });
    expect(await loginPhoneFor("Sara")).toBe("+18455550301");
    expect(await loginPhoneFor("(845) 555-0301")).toBe("+18455550301");
    expect(await loginPhoneFor("SARA@example.com")).toBe("+18455550301");
    expect(await loginPhoneFor("nobody")).toBe("nobody");
  });
  it("three choices, remembered on the device only; usernames on the Staff page and for the Owner", () => {
    const form = readFileSync("src/app/admin/login/LoginForm.tsx", "utf8");
    expect(form).toContain("SIGNIN_WAY_COOKIE");
    expect(readFileSync("src/app/admin/(app)/staff/StaffForms.tsx", "utf8")).toContain("data-owner-username");
    expect(readFileSync("src/app/admin/(app)/account/page.tsx", "utf8")).toContain("data-signin-way");
  });
});
