"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const NAV = [
  ["/admin", "📊", "Dashboard"],
  ["/admin/calendar", "📅", "Calendar"],
  ["/admin/orders", "🧾", "Orders"],
  ["/admin/pos", "➕", "New booking"],
  ["/admin/catalog", "📦", "Catalog"],
  ["/admin/calls", "📞", "Call log"],
  ["/admin/phone/prompts", "🎙️", "Hotline prompts"],
  ["/admin/settings", "⚙️", "Settings"],
] as const;

export default function Sidebar({ logout }: { logout: () => Promise<void> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  return (
    <>
      <div className="flex items-center justify-between bg-navy px-4 py-3 text-white lg:hidden">
        <span className="flex items-center gap-2 font-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-8" /> Hup Up
        </span>
        <button onClick={() => setOpen(!open)} className="rounded-lg px-3 py-1 text-2xl" aria-label="Menu">
          ☰
        </button>
      </div>
      <aside
        className={`${open ? "block" : "hidden"} bg-navy px-4 py-6 text-white lg:sticky lg:top-0 lg:block lg:h-screen lg:w-60 lg:shrink-0`}
      >
        <div className="mb-8 hidden items-center gap-3 text-xl font-black lg:flex">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-10" /> Hup Up
        </div>
        <nav className="space-y-1">
          {NAV.map(([href, icon, label]) => (
            <Link
              key={href}
              href={href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2.5 font-semibold ${
                active(href) ? "bg-white/10 opacity-100" : "opacity-75 hover:opacity-100"
              }`}
            >
              <span>{icon}</span> {label}
            </Link>
          ))}
        </nav>
        <form action={logout} className="mt-8">
          <button className="px-3.5 text-sm opacity-60 hover:opacity-100">Sign out</button>
        </form>
      </aside>
    </>
  );
}
