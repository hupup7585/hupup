import { requireStaff } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import DateInputHints from "@/components/DateInputHints";
import { myTaskBadge } from "@/lib/tasks";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks · Hup Up Attractions", robots: { index: false } };

/** Tasks are for all staff (Delivery sees only their own), so this section has its own layout. */
export default async function TasksLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff(["owner", "secretary", "delivery"]);
  return (
    <div className="min-h-screen bg-bg lg:flex">
      <Sidebar logout={logoutAction} role={staff.role} name={staff.name} taskBadge={await myTaskBadge(staff)} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
      <DateInputHints />
    </div>
  );
}
