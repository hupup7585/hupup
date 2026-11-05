import { requireAdmin } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";
import { logoutAction } from "../login/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Hup Up Attractions", robots: { index: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireAdmin();
  return (
    <div className="min-h-screen bg-bg lg:flex">
      <Sidebar logout={logoutAction} role={staff.role} name={staff.name} />
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8">{children}</main>
    </div>
  );
}
