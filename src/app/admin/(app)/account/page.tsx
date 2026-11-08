import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireStaff, smsLoginActive } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import PasswordForm from "./PasswordForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account | Hup Up Attractions" };

/** My account: Owner and Secretary set their own password (Delivery signs in with text codes only). */
export default async function AccountPage() {
  const me = await requireStaff(["owner", "secretary"]);
  const [u] = me.userId ? await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, me.userId)).limit(1) : [];
  return (
    <div className="mx-auto max-w-3xl" data-account>
      <h1 className="mb-1 text-2xl font-black sm:text-3xl">My account</h1>
      <p className="mb-5 text-muted">
        {me.name} · <span className="capitalize">{me.role}</span> · {formatPhone(me.phone)}
      </p>
      <section className="card p-5">
        <h2 className="mb-1 text-lg font-bold">{u?.passwordHash ? "Change your password" : "Set your password"}</h2>
        <p className="mb-4 text-sm text-muted">
          Sign in with your mobile number and this password.{" "}
          {smsLoginActive() ? "You can also sign in with a texted code." : "Text codes aren't active yet (waiting on Twilio approval), so a password is the way to sign in for now."}
          {!u?.passwordHash && " For your first password, do this within 15 minutes of signing in."}
        </p>
        <PasswordForm hasPassword={Boolean(u?.passwordHash)} />
      </section>
    </div>
  );
}
