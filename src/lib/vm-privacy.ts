import { sql, type SQL, type AnyColumn } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * The Owner's personal voicemail box is Owner only (Abraham, Nov 27, 2026, 10:36 AM ET; deep check 06:00 M64).
 * Anyone who is not the Owner (the Secretary) never sees, plays, downloads, marks or deletes a message in a personal
 * box that belongs to an Owner, anywhere in Admin (list, search, customer timeline, order page, audio and download
 * links) and never gets its alerts. The Secretary keeps the Main box, the extension boxes and her own personal box.
 *
 * One rule, used by every Admin page, action and route that touches a voicemail.
 */
export const OWNER_BOX_PRIVATE_NOTE =
  "The Owner's personal box is private: only the Owner can see, play, download or delete its messages, here and in search, on customer pages and in alerts. The Secretary sees the Main box, the extension boxes and her own personal box.";

/** Box ids this staff member may not see: the Owner's personal box(es), for everyone who is not the Owner. */
export async function hiddenBoxIds(staff: { role: string } | null | undefined): Promise<number[]> {
  if (staff?.role === "owner") return [];
  const rows = (await db.execute(sql`SELECT b.id FROM voicemail_boxes b JOIN admin_users u ON u.id = b.owner_user_id WHERE u.role = 'owner'`)).rows as { id: number }[];
  return rows.map((r) => Number(r.id));
}

/** May this staff member see this message (by its box)? */
export async function canSeeVoicemail(staff: { role: string } | null | undefined, v: { boxId: number } | null | undefined): Promise<boolean> {
  if (!staff || !v) return false;
  return !(await hiddenBoxIds(staff)).includes(Number(v.boxId));
}

/** Is this box one of the Owner's personal boxes? */
export async function isOwnerPersonalBox(boxId: number): Promise<boolean> {
  const rows = (await db.execute(sql`SELECT 1 FROM voicemail_boxes b JOIN admin_users u ON u.id = b.owner_user_id WHERE b.id = ${boxId} AND u.role = 'owner' LIMIT 1`)).rows;
  return rows.length > 0;
}

/** A query filter: messages of boxes this staff member may see (nothing filtered for the Owner). */
export function visibleBoxSql(boxIdColumn: AnyColumn, staff: { role: string } | null | undefined): SQL | undefined {
  if (staff?.role === "owner") return undefined;
  return sql`${boxIdColumn} NOT IN (SELECT b.id FROM voicemail_boxes b JOIN admin_users u ON u.id = b.owner_user_id WHERE u.role = 'owner')`;
}

/**
 * The alert recipients for a box: unchanged for every other box; for the Owner's personal box only the Owner's own
 * addresses (an Owner account's email or phone, the business owner email ADMIN_EMAIL, the business owner phone).
 */
export async function ownerOnlyRecipients(boxId: number, emails: string[], phones: string[]): Promise<{ emails: string[]; phones: string[] }> {
  if (!(await isOwnerPersonalBox(boxId))) return { emails, phones };
  const owners = (await db.execute(sql`SELECT lower(email) AS email, phone FROM admin_users WHERE role = 'owner'`)).rows as { email: string | null; phone: string | null }[];
  const okEmail = new Set([...owners.map((o) => o.email).filter(Boolean), (process.env.ADMIN_EMAIL ?? "").toLowerCase()].filter(Boolean) as string[]);
  const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10);
  const okPhone = new Set([...owners.map((o) => digits(o.phone)), digits(process.env.ADMIN_PHONE)].filter((d) => d.length === 10));
  return { emails: emails.filter((e) => okEmail.has(e.toLowerCase())), phones: phones.filter((p) => okPhone.has(digits(p))) };
}
