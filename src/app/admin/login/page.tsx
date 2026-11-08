import { redirect } from "next/navigation";
import { currentStaff, emailLoginActive, homeFor, smsLoginActive } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign-in · Hup Up Attractions", robots: { index: false } };

export default async function LoginPage() {
  // A database error here must not crash the page; the form still shows and reports the problem on submit.
  const staff = await currentStaff().catch((e) => (console.error("[staff sign-in] session check failed:", e), null));
  if (staff) redirect(homeFor(staff.role));
  return (
    <main className="grid min-h-screen place-items-center bg-navy px-4">
      <LoginForm smsActive={smsLoginActive()} emailActive={emailLoginActive()} />
    </main>
  );
}
