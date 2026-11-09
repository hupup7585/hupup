import { asc } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { Badge, PageHeader, Section } from "@/components/staff/ui";
import { AddStaffForm, StaffRowActions } from "./StaffForms";

export const dynamic = "force-dynamic";

/** Owner only: staff accounts. Owner and Secretary may use a password or a texted code; Delivery a texted code only. */
/** SMS v3 (Abraham): who can do what. The server enforces the same rules on every screen and action. */
const ROLE_TABLE: [string, string, string, string][] = [
  ["Promo campaigns", "Write, approve, cancel and send", "Send approved campaigns to eligible customers only (5-a-year limit); see campaign history and results", "No access"],
  ["Text consent records and text history", "Full access", "View on customer records", "No access"],
  ["Texting customers", "Approved templates and replies", "Approved templates (booking confirmations, payment links)", "Approved delivery templates only, to customers who agreed to order texts, with an optional proof photo; never promos"],
  ["Bookings, calendar, customers", "Full access", "Full access", "Only their own delivery and pickup stops"],
  ["Staff accounts and permissions", "Full access", "No access", "No access"],
  ["Settings, phone system, bookkeeping", "Full access", "No access", "No access"],
];

export default async function StaffPage() {
  await requireOwner();
  const users = await db.select().from(schema.adminUsers).orderBy(asc(schema.adminUsers.name));
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Staff" subtitle="Accounts are deactivated, never deleted. Deactivating signs the person out everywhere." />
      <Section title="Add a staff member">
        <AddStaffForm />
      </Section>
      <Section title={`Accounts (${users.length})`}>
        {!users.length && <p className="text-muted">No staff accounts yet. The owner signs in with the owner phone.</p>}
        <ul className="divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div>
                <div className="font-bold">{u.name}</div>
                <div className="text-sm text-muted">{formatPhone(u.phone)}{u.email ? ` · ${u.email}` : ""}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone={u.role === "owner" ? "done" : u.role === "secretary" ? "scheduled" : "pending"}>{u.role}</Badge>
                  {!u.active && <Badge tone="muted">Deactivated</Badge>}
                  {u.passwordHash && <Badge tone="muted">Password set</Badge>}
                  {u.lockedUntil && u.lockedUntil > new Date() && <Badge tone="alert">Locked</Badge>}
                </div>
              </div>
              <StaffRowActions userId={u.id} role={u.role} active={u.active} />
            </li>
          ))}
        </ul>
      </Section>
      <Section title="What each role can do">
        <table className="w-full text-sm" data-staff-permissions>
          <thead>
            <tr><th className="th">Area</th><th className="th">Owner</th><th className="th">Secretary</th><th className="th">Delivery</th></tr>
          </thead>
          <tbody>
            {ROLE_TABLE.map(([area, o, se, d]) => (
              <tr key={area} className="border-t border-line align-top">
                <td className="py-2 font-semibold">{area}</td>
                <td className="py-2">{o}</td>
                <td className="py-2">{se}</td>
                <td className="py-2">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-muted">Every staff action is logged with the person&rsquo;s name, date and time (Activity).</p>
      </Section>
    </div>
  );
}
