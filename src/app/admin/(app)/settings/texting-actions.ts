"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/**
 * Owner only: customer texts on for everyone, or only to the test numbers (the texting test window). Consent, STOP,
 * quiet hours and the card-number rules apply either way. Audited.
 */
export async function saveTextingAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  try {
    const everyone = form.get("customerTexts") === "on";
    const before = (await getSettings()).smsTestOnly;
    await saveSetting("smsTestOnly", !everyone, owner.userId);
    await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.customer_texts_updated", entityType: "settings", entityId: "sms_test_only", before: { smsTestOnly: before }, after: { smsTestOnly: !everyone } });
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Saved" };
  } catch {
    return { ok: false, message: "Not saved. Please try again." };
  }
}
