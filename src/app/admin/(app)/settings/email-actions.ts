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
