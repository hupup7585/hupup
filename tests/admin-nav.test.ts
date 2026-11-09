import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NAV_GROUPS, isActive, navFor } from "@/components/Sidebar";

/* Admin side menu in titled groups (Abraham). */
const titles = (role: "owner" | "secretary" | "delivery") => navFor(role).map((g) => g.title);
const labels = (role: "owner" | "secretary" | "delivery") => Object.fromEntries(navFor(role).map((g) => [g.title ?? "top", g.items.map(([, , l]) => l)]));

describe("grouped admin menu", () => {
  it("Owner sees every group in Abraham's order and items", () => {
    expect(titles("owner")).toEqual([null, "Orders & bookings", "Deliveries", "Phone system", "Bookkeeping", "Staff", "Settings"]);
    expect(labels("owner")).toEqual({
      top: ["Dashboard"],
      "Orders & bookings": ["Calendar", "Orders", "New booking", "Customers", "Catalog"],
      Deliveries: ["Deliveries", "Delivery settings"],
      "Phone system": ["Call log", "Voicemail", "Messages", "Hotline prompts", "Compliance", "Phone settings"],
      Bookkeeping: ["Bookkeeping"],
      Staff: ["Staff", "Tasks", "Activity"],
      Settings: ["Business hours & holidays", "General settings", "System status", "Staff screens (preview)"],
    });
  });

  it("role rules: Secretary and Delivery see only their items; empty groups are hidden", () => {
    expect(labels("secretary")).toEqual({
      "Orders & bookings": ["Calendar", "Orders", "New booking", "Customers"],
      Deliveries: ["Deliveries"],
      "Phone system": ["Call log", "Voicemail", "Messages", "Compliance"],
      Staff: ["Tasks"],
    });
    expect(labels("delivery")).toEqual({ Deliveries: ["Deliveries"], Staff: ["Tasks"] });
  });

  it("current page's group stays open; titles are small light-blue capitals; groups toggle; same menu on phone; account and sign out at the bottom", () => {
    expect(isActive("/admin/phone/settings", "/admin/phone/settings")).toBe(true);
    expect(isActive("/admin/phone/settings", "/admin/phone/prompts")).toBe(false);
    expect(isActive("/admin/delivery-settings", "/admin/deliveries")).toBe(false);
    expect(isActive("/admin/orders/12", "/admin/orders")).toBe(true);
    const s = readFileSync("src/components/Sidebar.tsx", "utf8");
    expect(s).toContain("text-[11px] font-bold uppercase tracking-[0.14em] text-sky");
    expect(s).toContain('data-nav-group={g.title} className="mt-4"');
    expect(s).toContain("aria-expanded={openNow}");
    expect(s).toContain("return here || (g.title ? toggled[g.title] === true : true);");
    expect(s.indexOf("NAV_BOTTOM.filter")).toBeLessThan(s.indexOf("<form action={logout}"));
    expect(NAV_GROUPS.flatMap((g) => g.items).some(([h]) => h === "/admin/account")).toBe(false);
  });

  it("the old Settings page is split by topic", () => {
    const general = readFileSync("src/app/admin/(app)/settings/page.tsx", "utf8");
    expect(general).toContain("General settings");
    for (const moved of ["<RoutingForm", "<BlockingForm", "<RecordingForm", "<StockAddressForm", "<CalendarSettingsForm"]) expect(general).not.toContain(moved);
    const phone = readFileSync("src/app/admin/(app)/phone/settings/page.tsx", "utf8");
    for (const f of ["<RoutingForm", "<BlockingForm", "<RecordingForm", "Twilio phone number setup", "await requireOwner()"]) expect(phone).toContain(f);
    const del = readFileSync("src/app/admin/(app)/delivery-settings/page.tsx", "utf8");
    for (const f of ["<DeliveryPricingForm", "<StockAddressForm", "DELIVERY_TEMPLATES", "await requireOwner()"]) expect(del).toContain(f);
    expect(readFileSync("src/app/admin/(app)/holidays/page.tsx", "utf8")).toContain("<CalendarSettingsForm");
    const act = readFileSync("src/app/admin/(app)/settings/pricing-actions.ts", "utf8");
    expect(act.match(/await requireOwner\(\)/g)).toHaveLength(2);
    expect(act).toContain("auditLog");
  });
});
