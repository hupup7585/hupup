"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { digitsTemplateError } from "@/lib/sola-phonepay";
import { toE164 } from "@/lib/phone";

/** Owner only: Sola PhonePay settings (Abraham, Nov 14, 2026). Every change is in the audit log; the PIN is never here. */
export async function savePhonePayAction(form: FormData) {
  const owner = await requireOwner();
  const back = (m: string) => redirect(`/admin/phone/phonepay?m=${encodeURIComponent(m)}`);
  const on = form.get("on") === "on";
  const ownerOnly = form.get("ownerOnly") === "on";
  const number = toE164(String(form.get("number") ?? ""));
  const backup = toE164(String(form.get("backup") ?? ""));
  const digits = String(form.get("digits") ?? "").replace(/\s+/g, "");
  if (!number || !backup) return back("Enter both PhonePay numbers, for example (833) 434-3354.");
  const err = digitsTemplateError(digits);
  if (err) return back(err);
  const before = await getSettings();
  await saveSetting("solaPhonePayOn", on, owner.userId);
  await saveSetting("solaPhonePayOwnerOnly", ownerOnly, owner.userId);
  await saveSetting("solaPhonePayNumber", number, owner.userId);
  await saveSetting("solaPhonePayBackup", backup, owner.userId);
  await saveSetting("solaPhonePayDigits", digits, owner.userId);
  await db.insert(schema.auditLog).values({
    userId: owner.userId,
    action: "settings.phonepay_updated",
    entityType: "settings",
    entityId: "sola_phonepay",
    before: { on: before.solaPhonePayOn, ownerOnly: before.solaPhonePayOwnerOnly, number: before.solaPhonePayNumber, backup: before.solaPhonePayBackup, digits: before.solaPhonePayDigits },
    after: { on, ownerOnly, number, backup, digits },
  });
  revalidatePath("/admin/phone/phonepay");
  return back("Saved.");
}
