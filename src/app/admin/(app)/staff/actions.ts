"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { hashPassword, requireOwner, revokeSessions } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { ROLES, type Role } from "@/lib/db/schema";
import { toE164 } from "@/lib/phone";

export type StaffResult = { ok: boolean; message: string };

/** A sign-in username (Abraham, Nov 14, 2026): 3 to 30 letters, numbers, dots, dashes or underscores, not only numbers. */
function cleanUsername(raw: string | undefined): { value: string | null; error?: string } {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return { value: null };
  if (!/^[a-z0-9._-]{3,30}$/.test(v) || /^\d+$/.test(v)) return { value: null, error: "A username has 3 to 30 letters or numbers (dots, dashes and underscores are fine), and not only numbers." };
  return { value: v };
}

async function usernameTaken(v: string, exceptId: number | null) {
  const { sql } = await import("drizzle-orm");
  const [u] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(sql`lower(${schema.adminUsers.username}) = ${v}`).limit(1);
  if (u && u.id !== exceptId) return true;
  const { getSettings } = await import("@/lib/settings");
  return exceptId !== -1 && (await getSettings()).ownerUsername === v;
}

async function log(userId: number | null, action: string, entityId: number, after: Record<string, unknown>) {
  await db.insert(schema.auditLog).values({ userId, action, entityType: "staff", entityId: String(entityId), after });
}

/** Owner only. */
export async function createStaffAction(form: { name: string; phone: string; role: Role; email?: string; password?: string; username?: string; googleEmail?: string }): Promise<StaffResult> {
  const owner = await requireOwner();
  const name = form.name.trim();
  const phone = toE164(form.phone);
  if (!name) return { ok: false, message: "Type the person's name first." };
  if (!phone) return { ok: false, message: "Type a 10-digit mobile number first, for example 845-415-7585." };
  if (!ROLES.includes(form.role)) return { ok: false, message: "Choose a role." };
  if (form.password && form.role === "delivery") return { ok: false, message: "Delivery accounts sign in with a texted code only. Leave the password empty." };
  if (form.password && form.password.length < 10) return { ok: false, message: "Type a password of at least 10 characters, or leave it empty." };
  let google: string | null = null;
  if (form.googleEmail?.trim()) {
    const { cleanGoogleEmail } = await import("@/lib/google-login");
    const g = cleanGoogleEmail(form.googleEmail);
    if (g.error) return { ok: false, message: g.error };
    google = g.value;
    // Deep check B3: a Google account already on another staff member gets a plain answer, not a database error
    if (google) {
      const { sql } = await import("drizzle-orm");
      const [dup] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(sql`lower(${schema.adminUsers.googleEmail}) = ${google}`).limit(1);
      if (dup) return { ok: false, message: "That Google account is already saved on another staff member." };
    }
  }
  const [exists] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(eq(schema.adminUsers.phone, phone)).limit(1);
  if (exists) return { ok: false, message: "That phone number already has an account." };
  const un = cleanUsername(form.username);
  if (un.error) return { ok: false, message: un.error };
  if (un.value && (await usernameTaken(un.value, null))) return { ok: false, message: "That username is already taken." };
  let passwordHash: string | null = null;
  try {
    if (form.password) passwordHash = await hashPassword(form.password);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  // Extra check F10 (Nov 27, 2026): two clicks at once both pass the checks above; the second hits the database's
  // one-account-per-phone (or username) rule and now gets the same message instead of an error page
  let u: { id: number };
  try {
    [u] = await db
      .insert(schema.adminUsers)
      .values({ name, phone, role: form.role, email: form.email?.trim() || null, username: un.value, passwordHash, passwordSetAt: passwordHash ? new Date() : null, googleEmail: google })
      .returning({ id: schema.adminUsers.id });
  } catch (e) {
    const code = (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code !== "23505") throw e;
    const detail = String((e as { detail?: string; cause?: { detail?: string } }).detail ?? (e as { cause?: { detail?: string } }).cause?.detail ?? "");
    return { ok: false, message: /username/i.test(detail) ? "That username is already taken." : "That phone number already has an account." };
  }
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

/** Owner only: set or clear a staff member's sign-in username (they can still use their phone number or email). */
export async function setUsernameAction(userId: number, username: string): Promise<StaffResult> {
  const owner = await requireOwner();
  const un = cleanUsername(username);
  if (un.error) return { ok: false, message: un.error };
  if (un.value && (await usernameTaken(un.value, userId))) return { ok: false, message: "That username is already taken." };
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, userId)).limit(1);
  if (!u) return { ok: false, message: "Account not found." };
  await db.update(schema.adminUsers).set({ username: un.value }).where(eq(schema.adminUsers.id, userId));
  await log(owner.userId, "staff.username_set", userId, { username: un.value });
  revalidatePath("/admin/staff");
  return { ok: true, message: un.value ? `${u.name} can now sign in as "${un.value}".` : `Username removed for ${u.name}.` };
}

/** Owner only: the Google account that may sign in as this staff member (Abraham, Nov 16, 2026). Blank removes it. */
export async function setGoogleEmailAction(userId: number, googleEmail: string): Promise<StaffResult> {
  const owner = await requireOwner();
  const { cleanGoogleEmail } = await import("@/lib/google-login");
  const g = cleanGoogleEmail(googleEmail);
  if (g.error) return { ok: false, message: g.error };
  if (g.value) {
    const { sql } = await import("drizzle-orm");
    const [other] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(sql`lower(${schema.adminUsers.googleEmail}) = ${g.value}`).limit(1);
    if (other && other.id !== userId) return { ok: false, message: "That Google account is already saved on another staff member." };
  }
  await db.update(schema.adminUsers).set({ googleEmail: g.value }).where(eq(schema.adminUsers.id, userId));
  await log(owner.userId, g.value ? "staff.google_email_set" : "staff.google_email_removed", userId, { googleEmail: g.value });
  revalidatePath("/admin/staff");
  return { ok: true, message: g.value ? "Saved. This Google account can now sign in to Admin." : "Removed. No Google account can sign in as this person." };
}

/** Owner only: the Owner's own sign-in username (the Owner has no staff row; kept in settings). */
export async function setOwnerUsernameAction(username: string): Promise<StaffResult> {
  const owner = await requireOwner();
  const un = cleanUsername(username);
  if (un.error) return { ok: false, message: un.error };
  if (un.value && (await usernameTaken(un.value, -1))) return { ok: false, message: "That username is already taken." };
  const { saveSetting } = await import("@/lib/settings");
  await saveSetting("ownerUsername", un.value ?? "", owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "owner.username_set", entityType: "staff", entityId: "owner", after: { username: un.value } });
  revalidatePath("/admin/staff");
  return { ok: true, message: un.value ? `You can now sign in as "${un.value}".` : "Your username was removed." };
}

/**
 * The simple Staff page's one Save (Abraham, Nov 26, 2026, 4:07 PM): name, mobile number, role, username, an
 * optional new password and an optional Google email, checked together. Every problem is said in plain words; nothing
 * is saved until all of it is right.
 */
export async function saveStaffAction(userId: number, form: { name: string; phone: string; role: Role; username: string; password: string; googleEmail: string }): Promise<StaffResult> {
  const owner = await requireOwner();
  const [u] = await db.select().from(schema.adminUsers).where(eq(schema.adminUsers.id, userId)).limit(1);
  if (!u) return { ok: false, message: "This account was not found. Reload the page." };
  const name = form.name.trim();
  const phone = toE164(form.phone);
  if (!name) return { ok: false, message: "Type the person's name first." };
  if (!phone) return { ok: false, message: "Type a 10-digit mobile number first, for example 845-415-7585." };
  if (!ROLES.includes(form.role)) return { ok: false, message: "Choose a role." };
  if (owner.userId === userId && form.role !== "owner") return { ok: false, message: "You cannot take away your own Owner role." };
  if (form.password && form.role === "delivery") return { ok: false, message: "Delivery accounts sign in with a texted code only. Leave the password empty." };
  if (form.password && form.password.length < 10) return { ok: false, message: "Type a password of at least 10 characters, or leave it empty to keep the current one." };
  const [other] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(eq(schema.adminUsers.phone, phone)).limit(1);
  if (other && other.id !== userId) return { ok: false, message: "That mobile number already belongs to another account." };
  const un = cleanUsername(form.username);
  if (un.error) return { ok: false, message: un.error };
  if (un.value && (await usernameTaken(un.value, userId))) return { ok: false, message: "That username is already taken. Try another one." };
  const { cleanGoogleEmail } = await import("@/lib/google-login");
  const g = form.googleEmail.trim() ? cleanGoogleEmail(form.googleEmail) : { value: null as string | null, error: undefined as string | undefined };
  if (g.error) return { ok: false, message: g.error };
  if (g.value) {
    const { sql } = await import("drizzle-orm");
    const [dup] = await db.select({ id: schema.adminUsers.id }).from(schema.adminUsers).where(sql`lower(${schema.adminUsers.googleEmail}) = ${g.value}`).limit(1);
    if (dup && dup.id !== userId) return { ok: false, message: "That Google account is already saved on another staff member." };
  }
  let passwordHash: string | undefined;
  if (form.password) {
    try {
      passwordHash = await hashPassword(form.password);
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }
  const toDelivery = form.role === "delivery" && u.role !== "delivery";
  await db
    .update(schema.adminUsers)
    .set({
      name,
      phone,
      role: form.role,
      username: un.value,
      googleEmail: g.value,
      ...(passwordHash ? { passwordHash, passwordSetAt: new Date(), failedLogins: 0, lockedUntil: null } : {}),
      ...(toDelivery ? { passwordHash: null } : {}), // Delivery signs in with a texted code only
    })
    .where(eq(schema.adminUsers.id, userId));
  const signOut = Boolean(passwordHash) || u.role !== form.role || u.phone !== phone;
  if (signOut) await revokeSessions(userId);
  await log(owner.userId, "staff.saved", userId, { name, role: form.role, phoneChanged: u.phone !== phone, roleChanged: u.role !== form.role, username: un.value, googleEmail: g.value, password: Boolean(passwordHash) });
  revalidatePath("/admin/staff");
  return { ok: true, message: `Saved ${name}.${signOut ? " They were signed out and sign in again with the new details." : ""}` };
}
