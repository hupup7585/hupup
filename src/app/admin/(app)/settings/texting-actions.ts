"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { toE164 } from "@/lib/phone";

/**
 * Owner only: customer texts on for everyone, or only to the test numbers (the texting test window). Consent, STOP,
 * quiet hours and the card-number rules apply either way. Audited.
 */
export async function saveTextingAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  try {
    const everyone = form.get("customerTexts") === "on";
    // Batch 2 item 7 (Nov 25, 2026): the test numbers and the forward of incoming texts, editable here too
    const lines = String(form.get("testNumbers") ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
    const tests = lines.map((x) => toE164(x));
    if (tests.some((x) => !x)) return { ok: false, message: "Not saved. Each test number must be a 10-digit phone number, one per line." };
    const forwardOn = form.get("forwardOn") === "on";
    const fwdRaw = String(form.get("forwardPhone") ?? "").trim();
    const fwd = fwdRaw ? toE164(fwdRaw) : "";
    if (fwdRaw && !fwd) return { ok: false, message: "Not saved. The forward number must be a 10-digit phone number." };
    if (forwardOn && !fwd) return { ok: false, message: "Not saved. Enter the number to forward incoming texts to." };
    const before = (await getSettings()).smsTestOnly;
    await saveSetting("smsTestOnly", !everyone, owner.userId);
    await saveSetting("smsTestNumbers", tests.join("\n"), owner.userId);
    await saveSetting("smsForwardEnabled", forwardOn, owner.userId);
    await saveSetting("smsForwardPhone", fwd ?? "", owner.userId);
    await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.customer_texts_updated", entityType: "settings", entityId: "sms_test_only", before: { smsTestOnly: before }, after: { smsTestOnly: !everyone } });
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Saved" };
  } catch {
    return { ok: false, message: "Not saved. Please try again." };
  }
}
