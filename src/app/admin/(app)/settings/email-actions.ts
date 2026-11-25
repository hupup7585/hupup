"use server";

import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/** The signature at the bottom of every email (Abraham, Nov 17, 2026). Empty = the approved default. */
export async function saveEmailSignatureAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const text = String(form.get("signature") ?? "").replace(/\r\n/g, "\n").trim();
  if (text.length > 800) return { ok: false, message: "Please keep the signature under 800 characters." };
  if (/<[^>]+>/.test(text)) return { ok: false, message: "Plain text only (no tags)." };
  const before = (await getSettings()).emailSignature;
  await saveSetting("emailSignature", text, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.email_signature", entityType: "settings", entityId: "emailSignature", before: { text: before }, after: { text } });
  return { ok: true, message: "Saved. Every email from now on ends with this signature." };
}

/** Batch 2 item 7 (Nov 25, 2026): the mailing address at the bottom of promotional emails (the law asks for one). */
export async function saveMailingAddressAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const text = String(form.get("address") ?? "").replace(/\s+/g, " ").trim();
  if (text.length > 200) return { ok: false, message: "Not saved. Please keep the address under 200 characters." };
  try {
    const before = (await getSettings()).emailMailingAddress;
    await saveSetting("emailMailingAddress", text, owner.userId);
    await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.email_mailing_address", entityType: "settings", entityId: "emailMailingAddress", before: { text: before }, after: { text } });
    return { ok: true, message: "Saved" };
  } catch {
    return { ok: false, message: "Not saved. Please try again." };
  }
}
