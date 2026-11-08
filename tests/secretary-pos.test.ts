import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham N: the Admin 'New booking' screen is for the Owner and the Secretary; Delivery doesn't get it. */
describe("New booking (POS) access", () => {
  it("Owner and Secretary may use it (requireAdmin lets both in and sends Delivery to Deliveries)", () => {
    const auth = readFileSync("src/lib/auth.ts", "utf8");
    expect(auth).toMatch(/export async function requireAdmin\(\) \{[\s\S]*?if \(s\.role === "delivery"\) redirect\("\/admin\/deliveries"\);/);
    expect(readFileSync("src/app/admin/(app)/layout.tsx", "utf8")).toContain("await requireAdmin()"); // guards every admin page, New booking included
    const actions = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    expect((actions.match(/await requireAdmin\(\)/g) || []).length).toBe(4); // every server action
    expect(readFileSync("src/components/Sidebar.tsx", "utf8")).toContain('["/admin/pos", PlusCircle, "New booking", OS]');
  });
  it("bookings there use the same shared inventory and whole-rental-day rules as the phone and website", () => {
    const actions = readFileSync("src/app/admin/(app)/pos/actions.ts", "utf8");
    expect(actions).toContain("createOrderWithItems(");
    const orders = readFileSync("src/lib/orders.ts", "utf8");
    expect(orders).toMatch(/export async function createOrderWithItems[\s\S]*?pickupDateFor\(opts\.eventDate/);
    expect(orders).toMatch(/async function reserveInTx[\s\S]*?checkBookable\(/);
  });
});
