import { redirect } from "next/navigation";
import { currentStaff, homeFor } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign-in · Hup Up Attractions", robots: { index: false } };

export default async function LoginPage() {
  const staff = await currentStaff();
  if (staff) redirect(homeFor(staff.role));
  return (
    <main className="grid min-h-screen place-items-center bg-navy px-4">
      <LoginForm />
    </main>
  );
}
