import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaff, smsLoginActive } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import PasswordForm from "./PasswordForm";
import { cookies } from "next/headers";
import { setSignInWayAction, signOutOtherDevicesAction } from "./actions";
import { and, gt } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account | Hup Up Attractions" };

/** My account: Owner and Secretary set their own password (Delivery signs in with text codes only). */
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ saved?: string; others?: string }> }) {
  const me = await requireStaff(["owner", "secretary"]);
  const { saved, others } = await searchParams;
  const way = (await cookies()).get("hup_signin_way")?.value ?? "password";
  const sessions = me.userId ? await db.select({ id: schema.adminSessions.id }).from(schema.adminSessions).where(and(eq(schema.adminSessions.userId, me.userId), gt(schema.adminSessions.expiresAt, new Date()))) : [];
  const [u] = me.userId ? await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, me.userId)).limit(1) : [];
  return (
    <div className="w-full" data-account>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">My account</h1>
      <p className="mb-5 text-muted">
        {me.name} · <span className="capitalize">{me.role}</span> · {formatPhone(me.phone)}{u?.username ? ` · username ${u.username}` : ""}
      </p>
      <section className="card mb-5 p-5" data-signin-way>
        <h2 className="mb-1 text-lg font-bold">My preferred sign-in way</h2>
        <p className="mb-3 text-sm text-muted">The sign-in page on this device opens on this choice. You can always pick another one there.</p>
        <form action={setSignInWayAction} className="flex flex-wrap items-center gap-2">
          <select name="way" defaultValue={way} className="input w-56" aria-label="Preferred sign-in way">
            <option value="password">Password</option>
            <option value="email">Code by email</option>
            <option value="sms">Code by text</option>
          </select>
          <button className="btn-ghost">Save</button>
          {saved === "way" && <span className="text-sm font-semibold text-navy">Saved for this device.</span>}
        </form>
      </section>
      <section className="card p-5">
        <h2 className="mb-1 text-lg font-bold">{u?.passwordHash ? "Change your password" : "Set your password"}</h2>
        <p className="mb-4 text-sm text-muted">
          Sign in with your username, mobile number or email, and this password.{" "}
          {smsLoginActive() ? "You can also sign in with a texted code." : "Text codes aren't active yet (waiting on Twilio approval), so a password is the way to sign in for now."}
          {!u?.passwordHash && " For your first password, do this within 15 minutes of signing in."}
        </p>
        <PasswordForm hasPassword={Boolean(u?.passwordHash)} />
      </section>
      <section className="card mt-5 p-5" id="devices" data-devices>
        <h2 className="mb-1 text-lg font-bold">Signed-in devices</h2>
        <p className="mb-3 text-sm text-muted">
          You are signed in on {sessions.length} {sessions.length === 1 ? "device" : "devices"}. Tick &ldquo;Keep me signed in on this device for 30 days&rdquo; when you sign in on your own phone or computer; other devices sign out after 12 hours.
        </p>
        {others !== undefined && <p role="status" className="mb-3 text-sm font-semibold text-[#13895C]">Saved. {others === "0" ? "No other devices were signed in." : `Signed out ${others} other ${others === "1" ? "device" : "devices"}.`}</p>}
        <form action={signOutOtherDevicesAction}>
          <button className="btn-ghost">Sign out all other devices</button>
        </form>
      </section>
    </div>
  );
}
