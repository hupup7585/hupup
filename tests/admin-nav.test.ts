import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NAV_GROUPS, folders, isActive, navFor } from "@/components/Sidebar";

/* Admin side menu in titled groups (Abraham). */
const titles = (role: "owner" | "secretary" | "delivery") => navFor(role).map((g) => g.title);
const labels = (role: "owner" | "secretary" | "delivery") => Object.fromEntries(navFor(role).map((g) => [g.title ?? "top", g.items.map(([, , l]) => l)]));

describe("grouped admin menu", () => {
  it("Owner sees every group in Abraham's order and items", () => {
    expect(titles("owner")).toEqual([null, "Orders & bookings", "Deliveries", "Phone system", "Bookkeeping", "Staff", "Settings"]);
    expect(labels("owner")).toEqual({
      top: ["Dashboard", "Inbox"], // Inbox: info@ (Abraham, Nov 12, 2026; Owner only)
      "Orders & bookings": ["Calendar", "Orders", "New booking", "Customers", "Catalog"],
      Deliveries: ["Deliveries", "Delivery settings"],
      "Phone system": ["Call log", "Voicemail", "Messages", "Campaigns", "Hotline prompts", "Compliance", "Phone settings"],
      Bookkeeping: ["Overview", "Income", "Invoices", "Expenses", "Bills I owe", "Sola fees", "Bank & card", "Sales tax", "Equipment", "Staff & 1099", "Mileage", "Reports", "All entries", "General ledger", "Settings"],
      Staff: ["Staff", "Tasks", "Activity"],
      Settings: ["Business hours & holidays", "General settings", "System status", "Staff screens (preview)"],
    });
  });

  it("role rules: Secretary and Delivery see only their items; empty groups are hidden", () => {
    expect(labels("secretary")).toEqual({
      "Orders & bookings": ["Calendar", "Orders", "New booking", "Customers"],
      Deliveries: ["Deliveries"],
      "Phone system": ["Call log", "Voicemail", "Messages", "Campaigns", "Compliance"],
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
    // Section titles look like "Dashboard" (same size, weight, color), in capital letters, no wide spacing
    expect(s).toContain("px-3 py-2.5 text-[15px] font-semibold uppercase text-white/75");
    expect(s).not.toContain("tracking-[0.14em] text-sky");
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

describe("Bookkeeping in the side menu (Abraham, Nov 9, 2026)", () => {
  it("every Bookkeeping page is its own item with its own link, in small groups; the open page is marked", async () => {
    const { BOOK_GROUPS } = await import("@/lib/bookkeeping-tabs");
    expect(BOOK_GROUPS.map((g) => [g.label, g.tabs.map(([, l]) => l)])).toEqual([
      ["Money in", ["Overview", "Income", "Invoices"]],
      ["Money out", ["Expenses", "Bills I owe", "Sola fees"]],
      ["Bank and tax", ["Bank & card", "Sales tax"]],
      ["Business", ["Equipment", "Staff & 1099", "Mileage"]],
      ["Records", ["Reports", "All entries", "General ledger", "Settings"]],
    ]);
    const book = navFor("owner").find((g) => g.title === "Bookkeeping")!;
    expect(book.items.map(([h]) => h)).toContain("/admin/bookkeeping?tab=bills");
    expect(book.items.every(([, , , , sub]) => Boolean(sub))).toBe(true);
    expect(isActive("/admin/bookkeeping", "/admin/bookkeeping?tab=bills", "bills")).toBe(true);
    expect(isActive("/admin/bookkeeping", "/admin/bookkeeping?tab=bills", "income")).toBe(false);
    expect(isActive("/admin/bookkeeping", "/admin/bookkeeping?tab=overview", null)).toBe(true);
    // Folders (Abraham): Money in, Money out, Bank and tax, Business, Records, each holding its own pages
    expect(folders(book.items).map((f) => [f.label, f.items.length])).toEqual([["Money in", 3], ["Money out", 3], ["Bank and tax", 2], ["Business", 3], ["Records", 4]]);
    const sb = readFileSync("src/components/Sidebar.tsx", "utf8");
    expect(sb).toContain("data-nav-folder={label}");
    expect(sb).toContain('onClick={() => setFolder(folderOpen(label, items) ? "" : label)}'); // only one open; click again closes
    expect(sb).toContain("folder === null ? items.some(([href]) => active(href)) : folder === label"); // the open page's folder stays open
    expect(sb).toContain('className="ml-4 space-y-0.5 border-l border-white/10 pl-1"'); // items slightly indented
    expect(sb).not.toContain("data-nav-sublabel");
  });
  it("each page's big title is its own name; the tab row shows only on phones", () => {
    const page = readFileSync("src/app/admin/(app)/bookkeeping/page.tsx", "utf8");
    expect(page).toContain("data-book-title>{bookTabLabel(tab)}</h1>");
    expect(page).toContain('className="mb-5 flex flex-wrap gap-2 lg:hidden" aria-label="Bookkeeping sections"');
  });
});
