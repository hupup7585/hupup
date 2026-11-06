"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireOwner } from "@/lib/auth";
import { sendMessage } from "@/lib/sms";
import { toE164 } from "@/lib/phone";

/**
 * Free-form text reply (Owner only, per the roles plan; Secretary and Delivery use approved templates).
 * Goes through sendMessage, so STOP, consent and card-number rules all apply and the message is logged.
 */
export async function sendReplyAction(_prev: { ok?: boolean; error?: string } | null, form: FormData): Promise<{ ok?: boolean; error?: string }> {
  const s = await requireOwner();
  const phone = toE164(String(form.get("phone") || ""));
  const body = String(form.get("body") || "").trim();
  if (!phone) return { error: "Enter a valid US or Canada mobile number." };
  if (!body) return { error: "Type a message first." };
  if (body.length > 1000) return { error: "Keep it under 1,000 characters." };
  const [c] = await db.select({ id: schema.customers.id }).from(schema.customers).where(eq(schema.customers.phone, phone)).limit(1);
  const r = await sendMessage({ to: phone, body, kind: "transactional", event: "staff_reply", userId: s.userId, customerId: c?.id ?? null });
  revalidatePath("/admin/messages");
  if (!r.sent) return { error: r.error || "Not sent." };
  return { ok: true };
}
