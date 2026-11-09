"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Activity, Calculator, CircleUser, CalendarClock, ListChecks, CalendarDays, Contact, History, ClipboardList, ChevronDown, LayoutDashboard, LogOut, Menu, MessageSquare, Mic, Package, Palette, PhoneCall, PhoneForwarded, PlusCircle, Settings, ShieldCheck, SlidersHorizontal, Truck, Users, Voicemail, X, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/db/schema";

const O: Role[] = ["owner"];
const OS: Role[] = ["owner", "secretary"];
const ALL: Role[] = ["owner", "secretary", "delivery"];
type Item = [string, LucideIcon, string, Role[]];
type Group = { title: string | null; items: Item[] };

/**
 * Side menu in titled groups (Abraham). Each role sees only the screens it can use (the server enforces the same
 * rules); a group with nothing for that role is hidden. My account and Sign out sit at the bottom.
 */
export const NAV_GROUPS: Group[] = [
  { title: null, items: [["/admin", LayoutDashboard, "Dashboard", O]] },
  {
    title: "Orders & bookings",
    items: [
      ["/admin/calendar", CalendarDays, "Calendar", OS],
      ["/admin/orders", ClipboardList, "Orders", OS],
      ["/admin/pos", PlusCircle, "New booking", OS],
      ["/admin/customers", Contact, "Customers", OS],
      ["/admin/catalog", Package, "Catalog", O],
    ],
  },
  {
    title: "Deliveries",
    items: [
      ["/admin/deliveries", Truck, "Deliveries", ALL],
      ["/admin/delivery-settings", SlidersHorizontal, "Delivery settings", O],
    ],
  },
  {
    title: "Phone system",
    items: [
      ["/admin/calls", PhoneCall, "Call log", OS],
      ["/admin/voicemail", Voicemail, "Voicemail", OS],
      ["/admin/messages", MessageSquare, "Messages", OS],
      ["/admin/phone/prompts", Mic, "Hotline prompts", O],
      ["/admin/compliance", ShieldCheck, "Compliance", OS],
      ["/admin/phone/settings", PhoneForwarded, "Phone settings", O],
    ],
  },
  { title: "Bookkeeping", items: [["/admin/bookkeeping", Calculator, "Bookkeeping", O]] },
  {
    title: "Staff",
    items: [
      ["/admin/staff", Users, "Staff", O],
      ["/admin/tasks", ListChecks, "Tasks", ALL],
      ["/admin/activity", History, "Activity", O],
    ],
  },
  {
    title: "Settings",
    items: [
      ["/admin/holidays", CalendarClock, "Business hours & holidays", O],
      ["/admin/settings", Settings, "General settings", O],
      ["/admin/status", Activity, "System status", O],
      ["/admin/design", Palette, "Staff screens (preview)", O],
    ],
  },
];
export const NAV_BOTTOM: Item[] = [["/admin/account", CircleUser, "My account", OS]];

/** The groups (and items) this role may see; empty groups are dropped. */
export function navFor(role: Role): Group[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(([, , , roles]) => roles.includes(role)) })).filter((g) => g.items.length > 0);
}

export const isActive = (path: string, href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(href + "/"));

/** Staff navigation: navy bar, yellow marker on the current page. Hidden when printing. */
export default function Sidebar({ logout, role = "owner", name, taskBadge }: { logout: () => Promise<void>; role?: Role; name?: string; taskBadge?: { open: number; overdue: number } }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => isActive(path, href);
  const groups = navFor(role);
  // Which groups are open: the group of the current page starts open; a click opens or closes any group.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("hupup-nav-groups") || "{}");
      if (saved && typeof saved === "object") setToggled(saved);
    } catch {}
  }, []);
  const isOpen = (g: Group) => {
    const here = g.items.some(([href]) => active(href));
    return here || (g.title ? toggled[g.title] === true : true);
  };
  const toggle = (title: string, now: boolean) => {
    const next = { ...toggled, [title]: !now };
    setToggled(next);
    try {
      localStorage.setItem("hupup-nav-groups", JSON.stringify(next));
    } catch {}
  };
  const link = ([href, Icon, label]: Item) => {
    const on = active(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={() => setOpen(false)}
        aria-current={on ? "page" : undefined}
        className={`relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] font-semibold transition ${on ? "bg-white/10 text-white" : "text-white/75 hover:bg-white/5 hover:text-white"}`}
      >
        {on && <span className="absolute inset-y-1.5 left-0 w-1 rounded-full bg-sun" aria-hidden />}
        <Icon className={`h-[18px] w-[18px] shrink-0 ${on ? "text-sun" : "text-sky"}`} strokeWidth={2} aria-hidden />
        {label}
        {href === "/admin/tasks" && taskBadge && taskBadge.open > 0 && (
          <span
            data-task-badge
            className={`ml-auto rounded-full px-2 py-0.5 text-xs font-bold ${taskBadge.overdue ? "bg-[#C83A2F] text-white" : "bg-white/15 text-white"}`}
            title={`${taskBadge.open} open task${taskBadge.open === 1 ? "" : "s"}${taskBadge.overdue ? `, ${taskBadge.overdue} overdue` : ""}`}
          >
            {taskBadge.open}
            <span className="sr-only"> open tasks{taskBadge.overdue ? `, ${taskBadge.overdue} overdue` : ""}</span>
          </span>
        )}
      </Link>
    );
  };
  return (
    <>
      <div className="no-print sticky top-0 z-30 flex items-center justify-between bg-navy px-4 py-3 text-white lg:hidden">
        <span className="font-display text-lg font-extrabold tracking-tight">
          Hup Up <span className="text-sun">Attractions</span>
        </span>
        <button onClick={() => setOpen(!open)} className="rounded-lg p-2 hover:bg-white/10" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>
      <aside className={`${open ? "block" : "hidden"} no-print bg-navy px-3 py-5 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:overflow-y-auto`}>
        {/* Centered under the logo on desktop and in the phone menu (Abraham) */}
        <div className="mb-8 flex flex-col items-center px-1 text-center" data-sidebar-head>
          {/* Logo on a white panel (never directly on navy) */}
          <div className="w-full rounded-xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/hupup-logo-h96@1x.png" srcSet="/brand/hupup-logo-h96@1x.png 1x, /brand/hupup-logo-h96@2x.png 2x, /brand/hupup-logo-h96@3x.png 3x" width={91} height={96} alt="Hup Up Attractions" className="mx-auto h-24 w-auto" />
          </div>
          <div className="mt-3 w-full text-center text-xs font-semibold uppercase tracking-[0.16em] text-sky">Staff portal</div>
          {name && <div className="mt-2 w-full text-center text-sm font-bold text-white">{name}</div>}
          <div className="w-full text-center text-xs capitalize text-white/70">{role}</div>
        </div>
        <nav aria-label="Admin menu">
          {groups.map((g) => {
            if (!g.title) return <div key="top" className="space-y-0.5">{g.items.map(link)}</div>;
            const openNow = isOpen(g);
            const id = `nav-${g.title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
            return (
              <div key={g.title} data-nav-group={g.title} className="mt-4">
                <button
                  type="button"
                  onClick={() => toggle(g.title!, openNow)}
                  aria-expanded={openNow}
                  aria-controls={id}
                  className="flex w-full items-center justify-between rounded-md px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-sky hover:text-white"
                >
                  {g.title}
                  <ChevronDown className={`h-3.5 w-3.5 transition ${openNow ? "" : "-rotate-90"}`} aria-hidden />
                </button>
                {openNow && (
                  <div id={id} className="mt-1 space-y-0.5">
                    {g.items.map(link)}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="mt-8 space-y-0.5 border-t border-white/10 pt-3 lg:mt-auto">
          {NAV_BOTTOM.filter(([, , , roles]) => roles.includes(role)).map(link)}
        </div>
        <form action={logout} className="mt-1">
          <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/5 hover:text-white">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </form>
      </aside>
    </>
  );
}
