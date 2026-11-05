import { asc } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { Badge, PageHeader, Section } from "@/components/staff/ui";
import { AddStaffForm, StaffRowActions } from "./StaffForms";

export const dynamic = "force-dynamic";

/** Owner only: staff accounts. Owner and Secretary may use a password or a texted code; Delivery a texted code only. */
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
    </div>
  );
}
