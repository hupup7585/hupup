import { redirect } from "next/navigation";
import { getSession, maskedDestination } from "@/lib/auth";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin sign-in · Hup Up Attractions", robots: { index: false } };

export default async function LoginPage() {
  if (await getSession()) redirect("/admin");
  return (
    <main className="grid min-h-screen place-items-center bg-bg bg-[radial-gradient(circle_at_20%_20%,#FFE9D6,transparent_40%),radial-gradient(circle_at_80%_80%,#DDF0FF,transparent_40%)] px-4">
      <LoginForm sms={maskedDestination("sms")} email={maskedDestination("email")} />
    </main>
  );
}
