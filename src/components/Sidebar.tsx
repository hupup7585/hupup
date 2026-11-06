"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CalendarClock, CalendarDays, Contact, History, ClipboardList, LayoutDashboard, LogOut, Menu, MessageSquare, Mic, Package, Palette, PhoneCall, PlusCircle, Settings, ShieldCheck, Truck, Users, Voicemail, X, type LucideIcon } from "lucide-react";
import type { Role } from "@/lib/db/schema";

const O: Role[] = ["owner"];
const OS: Role[] = ["owner", "secretary"];
/** Each role sees only the screens it can use (the server enforces the same rules). */
const NAV: [string, LucideIcon, string, Role[]][] = [
  ["/admin", LayoutDashboard, "Dashboard", O],
  ["/admin/calendar", CalendarDays, "Calendar", OS],
  ["/admin/orders", ClipboardList, "Orders", OS],
  ["/admin/pos", PlusCircle, "New booking", OS],
  ["/admin/deliveries", Truck, "Deliveries", OS],
  ["/admin/customers", Contact, "Customers", OS],
  ["/admin/catalog", Package, "Catalog", O],
  ["/admin/calls", PhoneCall, "Call log", OS],
  ["/admin/voicemail", Voicemail, "Voicemail", OS],
  ["/admin/messages", MessageSquare, "Messages", OS],
  ["/admin/phone/prompts", Mic, "Hotline prompts", O],
  ["/admin/compliance", ShieldCheck, "Compliance", OS],
  ["/admin/staff", Users, "Staff", O],
  ["/admin/activity", History, "Activity", O],
  ["/admin/holidays", CalendarClock, "Holidays & hours", O],
  ["/admin/settings", Settings, "Settings", O],
  ["/admin/design", Palette, "Staff screens (preview)", O],
];

/** Staff navigation: navy bar, yellow marker on the current page. Hidden when printing. */
export default function Sidebar({ logout, role = "owner", name }: { logout: () => Promise<void>; role?: Role; name?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
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
      <aside className={`${open ? "block" : "hidden"} no-print bg-navy px-3 py-5 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col`}>
        <div className="mb-8 hidden px-1 lg:block">
          {/* Logo on a white panel (never directly on navy) */}
          <div className="rounded-xl bg-white p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/hupup-logo-320.png" alt="Hup Up Attractions" className="mx-auto h-24 w-auto" />
          </div>
          <div className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky">Staff portal</div>
          {name && <div className="mt-3 text-sm text-white/80">{name} · <span className="capitalize">{role}</span></div>}
        </div>
        <nav className="space-y-0.5">
          {NAV.filter(([, , , roles]) => roles.includes(role)).map(([href, Icon, label]) => {
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
              </Link>
            );
          })}
        </nav>
        <form action={logout} className="mt-8 lg:mt-auto">
          <button className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/5 hover:text-white">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </form>
      </aside>
    </>
  );
}
