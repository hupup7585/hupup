import { Suspense } from "react";
import { requireAdmin } from "@/lib/auth";
import { myTaskBadge } from "@/lib/tasks";
import { inboxUnreadCount } from "@/lib/inbox";
import Sidebar from "@/components/Sidebar";
import DateInputHints from "@/components/DateInputHints";
import { logoutAction } from "../login/actions";
import { after } from "next/server";
import { runWhileAwake } from "@/lib/cron-schedule";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Hup Up Attractions", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireAdmin();
  // Staff are using Admin, so the database is awake anyway: the time-sensitive jobs get a chance to run, after the page
  after(() => runWhileAwake().catch((e) => console.error("[run while awake]", e)));
  return (
    <div className="min-h-screen bg-bg lg:flex">
      <Suspense fallback={null}>
        <Sidebar logout={logoutAction} role={staff.role} name={staff.name} taskBadge={await myTaskBadge(staff)} inboxUnread={staff.role === "owner" ? await inboxUnreadCount() : 0} />
      </Suspense>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
      <DateInputHints />
    </div>
  );
}
