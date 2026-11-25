import { describe, expect, it } from "vitest";
import { orderIdFromParam, orderPath } from "@/lib/order-path";
import { readFileSync } from "node:fs";

/* Batch 4 item 2 (Abraham, Nov 25, 2026): order 1031 opens /admin/orders/1031; older id links still work. */
describe("order number in URLs", () => {
  it("the order number and the old id both find the order", () => {
    expect(orderPath(31)).toBe("/admin/orders/1031");
    expect(orderIdFromParam("1031")).toBe(31);
    expect(orderIdFromParam("31")).toBe(31);
    expect(orderIdFromParam("#1077")).toBe(77);
    expect(orderIdFromParam("abc")).toBe(0);
  });
  it("the order page and the pay page read the number", () => {
    expect(readFileSync("src/app/admin/(app)/orders/[id]/page.tsx", "utf8")).toContain("orderIdFromParam(id)");
    expect(readFileSync("src/app/pay/[orderId]/page.tsx", "utf8")).toContain("orderIdFromParam(orderId)");
  });
});
