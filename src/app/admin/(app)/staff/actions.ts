"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { hashPassword, requireOwner, revokeSessions } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { ROLES, type Role } from "@/lib/db/schema";
import { toE164 } from "@/lib/phone";

export type StaffResult = { ok: boolean; message: string };

async function log(userId: number | null, action: string, entityId: number, after: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ userId, action, entityType: "staff", entityId: String(entityId), after });
}

/** Owner only. */
export async function createStaffAction(form: { name: string; phone: string; role: Role; email?: string; password?: string }): Promise<StaffResult> {
  const owner = await requireOwner();
  const name = form.name.trim();
  const phone = toE164(form.phone);
  if (!name) return { ok: false, message: "Enter a name." };
  if (!phone) return { ok: false, message: "Enter a valid 10-digit mobile number." };
  if (!ROLES.includes(form.role)) return { ok: false, message: "Choose a role." };
  if (form.password && form.role === "delivery") return { ok: false, message: "Delivery accounts sign in with a texted code only." };
  const [exists] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(eq(schema.adminUsers.phone, phone)).limit(1);
  if (exists) return { ok: false, message: "That phone number already has an account." };
  let passwordHash: string | null = null;
  try {
    if (form.password) passwordHash = await hashPassword(form.password);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const [u] = await db
    .insert(schema.adminUsers)
    .values({ name, phone, role: form.role, email: form.email?.trim() || null, passwordHash, passwordSetAt: passwordHash ? new Date() : null })
    .returning({ id: schema.adminUsers.id });
  await log(owner.userId, "staff.created", u.id, { name, role: form.role, password: Boolean(passwordHash) });
  revalidatePath("/admin/staff");
  return { ok: true, message: `Added ${name} (${form.role}).` };
}

export async function setPasswordAction(userId: number, password: string): Promise<StaffResult> {
  const owner = await requireOwner();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, userId)).limit(1);
  if (!u) return { ok: false, message: "Account not found." };
  if (u.role === "delivery") return { ok: false, message: "Delivery accounts sign in with a texted code only." };
  let hash: string;
  try {
    hash = await hashPassword(password);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  await db.update(schema.adminUsers).set({ passwordHash: hash, passwordSetAt: new Date(), failedLogins: 0, lockedUntil: null }).where(eq(schema.adminUsers.id, userId));
  await revokeSessions(userId); // a reset signs them out everywhere
  await log(owner.userId, "staff.password_set", userId, {});
  revalidatePath("/admin/staff");
  return { ok: true, message: `Password set for ${u.name}. They were signed out everywhere.` };
}

export async function setActiveAction(userId: number, active: boolean): Promise<StaffResult> {
  const owner = await requireOwner();
  if (owner.userId === userId && !active) return { ok: false, message: "You can't deactivate your own account." };
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, userId)).limit(1);
  if (!u) return { ok: false, message: "Account not found." };
  await db.update(schema.adminUsers).set({ active }).where(eq(schema.adminUsers.id, userId));
  if (!active) await revokeSessions(userId);
  await log(owner.userId, active ? "staff.reactivated" : "staff.deactivated", userId, { name: u.name });
  revalidatePath("/admin/staff");
  return { ok: true, message: active ? `${u.name} reactivated.` : `${u.name} deactivated and signed out. History is kept.` };
}
