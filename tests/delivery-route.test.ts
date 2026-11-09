import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GOOGLE_MAX_WAYPOINTS, dayRunLinks, firstLeg, googleDirections, googleRunLinks, nextLeg, wazeTo, type RouteStop } from "@/lib/delivery-route";

/*
 * Delivery screen navigation: free Google Maps and Waze links only (no API key), stops in the order shown,
 * then back to stock. The stock address is an owner-only setting.
 */
const h = vi.hoisted(() => ({ role: "owner" as "owner" | "secretary" | "delivery" }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireOwner: async () => {
    if (h.role !== "owner") throw new Error("NEXT_REDIRECT");
    return { userId: 1, role: "owner", name: "Owner" };
  },
}));

const STOCK = "51 Forest Rd, Monroe, NY 10950";
const s = (key: string, address: string | null, label: string, done = false): RouteStop => ({ key, address, label, done });
const q = (url: string) => new URL(url).searchParams;

describe("link builders (free links, no API key)", () => {
  it("Google Maps directions: origin, destination, stops in between, driving", () => {
    const u = googleDirections("1 Main St, Monroe, NY", "2 Elm St, Chester, NY", ["3 Oak St, Monroe, NY"]);
    expect(u.startsWith("https://www.google.com/maps/dir/?api=1&")).toBe(true);
    expect(q(u).get("origin")).toBe("1 Main St, Monroe, NY");
    expect(q(u).get("destination")).toBe("2 Elm St, Chester, NY");
    expect(q(u).get("waypoints")).toBe("3 Oak St, Monroe, NY");
    expect(q(u).get("travelmode")).toBe("driving");
    expect(u).not.toMatch(/key=/);
    expect(q(googleDirections(null, "2 Elm St")).has("origin")).toBe(false); // from the phone's location
  });
  it("Waze: drive to the address from where the phone is", () => {
    expect(wazeTo("12 Forest Rd, Monroe, NY")).toBe("https://waze.com/ul?q=12%20Forest%20Rd%2C%20Monroe%2C%20NY&navigate=yes");
  });
  it("long runs split into parts of at most 9 stops in between; each part starts where the last ended", () => {
    const pts = Array.from({ length: 25 }, (_, i) => `${i + 1} Main St`);
    const links = googleRunLinks(pts, false, "Whole day");
    expect(links.map((l) => l.label)).toEqual(["Whole day (part 1 of 3)", "Whole day (part 2 of 3)", "Whole day (part 3 of 3)"]);
    const visited: string[] = [q(links[0].url).get("origin")!];
    for (const l of links) {
      const p = q(l.url);
      const wps = p.get("waypoints") ? p.get("waypoints")!.split("|") : [];
      expect(wps.length).toBeLessThanOrEqual(GOOGLE_MAX_WAYPOINTS);
      expect(p.get("origin")).toBe(visited[visited.length - 1]);
      visited.push(...wps, p.get("destination")!);
    }
    expect(visited).toEqual(pts); // every stop once, in order
  });
  it("two stops in a row at the same house count once", () => {
    const [l] = googleRunLinks(["1 Main St", "1 main st", "2 Elm St"], false, "Run");
    expect(q(l.url).get("origin")).toBe("1 Main St");
    expect(q(l.url).has("waypoints")).toBe(false);
    expect(q(l.url).get("destination")).toBe("2 Elm St");
  });
});

describe("the driver's run", () => {
  const stops = [
    s("1-pickup", "10 Garfield Rd, Monroe, NY", "Pick up · Weiss"),
    s("2-delivery", "20 Forest Rd, Monroe, NY", "Drop off · Friedman"),
    s("3-delivery", null, "Drop off · No address"),
    s("4-delivery", "40 Bakertown Rd, Monroe, NY", "Drop off · Klein"),
  ];
  it("each stop leads to the next one (pick up from the last customer, then drop off at the next), then back to stock", () => {
    const a = nextLeg(stops, 0, STOCK)!;
    expect(a).toMatchObject({ label: "Drop off · Friedman", address: "20 Forest Rd, Monroe, NY", toStock: false });
    expect(q(a.google).get("origin")).toBe("10 Garfield Rd, Monroe, NY");
    expect(q(a.google).get("destination")).toBe("20 Forest Rd, Monroe, NY");
    expect(a.waze).toBe(wazeTo("20 Forest Rd, Monroe, NY"));
    expect(nextLeg(stops, 1, STOCK)!.label).toBe("Drop off · Klein"); // skips the stop with no address
    const home = nextLeg(stops, 3, STOCK)!;
    expect(home).toMatchObject({ label: "Back to stock", address: STOCK, toStock: true });
    expect(q(home.google).get("origin")).toBe("40 Bakertown Rd, Monroe, NY");
    expect(nextLeg(stops, 3, null)).toBeNull(); // no stock address: nothing after the last stop
  });
  it("finished stops are skipped as a next destination", () => {
    const done = stops.map((x) => (x.key === "2-delivery" ? { ...x, done: true } : x));
    expect(nextLeg(done, 0, STOCK)!.label).toBe("Drop off · Klein");
    expect(firstLeg(done)!.label).toBe("Pick up · Weiss");
    expect(firstLeg(done.map((x) => ({ ...x, done: true })))).toBeNull();
  });
  it("whole day: stock, every stop in the order shown, back to stock; remaining stops from here once some are done", () => {
    const { whole, remaining } = dayRunLinks(stops, STOCK);
    expect(whole).toHaveLength(1);
    const p = q(whole[0].url);
    expect(p.get("origin")).toBe(STOCK);
    expect(p.get("waypoints")).toBe("10 Garfield Rd, Monroe, NY|20 Forest Rd, Monroe, NY|40 Bakertown Rd, Monroe, NY");
    expect(p.get("destination")).toBe(STOCK);
    expect(remaining).toEqual([]); // nothing done yet
    const later = dayRunLinks(stops.map((x, i) => ({ ...x, done: i < 2 })), STOCK);
    const r = q(later.remaining[0].url);
    expect(r.has("origin")).toBe(false);
    expect(r.get("waypoints")).toBe("40 Bakertown Rd, Monroe, NY");
    expect(r.get("destination")).toBe(STOCK);
  });
  it("without a stock address the day starts from the driver's location and ends at the last stop", () => {
    const p = q(dayRunLinks(stops, null).whole[0].url);
    expect(p.has("origin")).toBe(false);
    expect(p.get("destination")).toBe("40 Bakertown Rd, Monroe, NY");
  });
});

describe("stock / warehouse address setting (owner only)", () => {
  beforeEach(() => {
    h.role = "owner";
  });
  it("the owner saves it (audited) and the Delivery screen reads it", async () => {
    const { saveStockAddressAction } = await import("@/app/admin/(app)/settings/stock-actions");
    const { getSettings } = await import("@/lib/settings");
    const { db, schema } = await import("@/lib/db");
    const f = new FormData();
    f.set("stockAddress", "  51 Forest Rd,   Monroe, NY 10950 ");
    expect(await saveStockAddressAction(null, f)).toEqual({ ok: true, message: "Saved." });
    expect((await getSettings()).stockAddress).toBe(STOCK);
    const audit = await db.select().from(schema.auditLog);
    expect(audit.some((a) => a.action === "settings.stock_address_updated")).toBe(true);
    const bad = new FormData();
    bad.set("stockAddress", "12345");
    expect((await saveStockAddressAction(null, bad)).ok).toBe(false);
  });
  it("secretaries and drivers can't change it", async () => {
    const { saveStockAddressAction } = await import("@/app/admin/(app)/settings/stock-actions");
    for (const role of ["secretary", "delivery"] as const) {
      h.role = role;
      await expect(saveStockAddressAction(null, new FormData())).rejects.toThrow();
    }
  });
  it("the form sits on the owner-only Settings page; the Delivery screen uses only the free links", () => {
    expect(readFileSync("src/app/admin/(app)/delivery-settings/page.tsx", "utf8")).toMatch(/await requireOwner\(\)[\s\S]*<StockAddressForm/);
    const page = readFileSync("src/app/admin/deliveries/page.tsx", "utf8");
    for (const part of ["dayRunLinks(", "nextLeg(", "firstLeg(", 'data-nav="google"', 'data-nav="waze"']) expect(page).toContain(part);
    const lib = readFileSync("src/lib/delivery-route.ts", "utf8");
    expect(lib).not.toMatch(/maps\.googleapis\.com|routes\.googleapis|GOOGLE_MAPS_API_KEY|key=/);
  });
});
