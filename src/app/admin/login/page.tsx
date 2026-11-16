import { redirect } from "next/navigation";
import { currentStaff, emailLoginActive, homeFor, smsLoginActive } from "@/lib/auth";
import { cookies } from "next/headers";
import LoginForm, { SIGNIN_WAY_COOKIE, type SignInWay } from "./LoginForm";
import { GOOGLE_FAILED, GOOGLE_NOT_SET_UP, googleLoginActive } from "@/lib/google-login";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff sign-in · Hup Up Attractions", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const g = (await searchParams).google;
  const googleError = g === "not_set_up" ? GOOGLE_NOT_SET_UP : g === "failed" ? GOOGLE_FAILED : null;
  // A database error here must not crash the page; the form still shows and reports the problem on submit.
  const staff = await currentStaff().catch((e) => (console.error("[staff sign-in] session check failed:", e), null));
  if (staff) redirect(homeFor(staff.role));
  // The way last used (or chosen on My account) on this device; nothing about any account
  const saved = (await cookies()).get(SIGNIN_WAY_COOKIE)?.value;
  const initialWay: SignInWay = saved === "email" || saved === "sms" ? saved : "password";
  return (
    <main className="grid min-h-screen place-items-center bg-navy px-4">
      <LoginForm smsActive={smsLoginActive()} emailActive={emailLoginActive()} googleActive={googleLoginActive()} googleError={googleError} initialWay={initialWay} />
    </main>
  );
}
