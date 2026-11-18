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
  const customDigits = String(form.get("customDigits") ?? "").replace(/\s+/g, "");
  const customErr = digitsTemplateError(customDigits);
  if (customErr) return back(`Custom charge: ${customErr}`);
  const capDollars = Number(String(form.get("customCap") ?? "").replace(/[$,\s]/g, ""));
  if (!Number.isFinite(capDollars) || capDollars < 1 || capDollars > 99999) return back("The highest custom amount must be between $1.00 and $99,999.00.");
  const customCap = String(Math.round(capDollars * 100));
  const testLines = String(form.get("testNumbers") ?? "").split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const testNumbers = testLines.map((x) => toE164(x));
  if (testNumbers.some((x) => !x)) return back("Each payment test number must be a 10-digit phone number, one per line.");
  // Limits (Abraham, Nov 17, 2026): tries per call, and declines per caller phone in 24 hours
  const tries = Math.floor(Number(form.get("triesPerCall")));
  const declines = Math.floor(Number(form.get("declinesPerDay")));
  if (!(tries >= 1 && tries <= 20) || !(declines >= 1 && declines <= 20)) return back("Tries per call and declines per day must each be a number from 1 to 20.");
  const before = await getSettings();
  await saveSetting("phonePayTriesPerCall", String(tries), owner.userId);
  await saveSetting("phonePayDeclinesPerDay", String(declines), owner.userId);
  const waitSec = Number(form.get("declineHangupSeconds"));
  if (Number.isFinite(waitSec) && waitSec >= 0 && waitSec <= 15) await saveSetting("phonePayDeclineHangupSeconds", String(waitSec), owner.userId);
  await saveSetting("solaPhonePayOn", on, owner.userId);
  await saveSetting("solaPhonePayOwnerOnly", ownerOnly, owner.userId);
  await saveSetting("solaPhonePayNumber", number, owner.userId);
  await saveSetting("solaPhonePayBackup", backup, owner.userId);
  await saveSetting("solaPhonePayDigits", digits, owner.userId);
  await saveSetting("solaPhonePayCustomDigits", customDigits, owner.userId);
  await saveSetting("solaPhonePayCustomCapCents", customCap, owner.userId);
  await saveSetting("paymentTestNumbers", testNumbers.join("\n"), owner.userId);
  const provider = form.get("provider") === "stripe" ? "stripe" : "sola";
  await saveSetting("phoneCardProvider", provider, owner.userId);
  await db.insert(schema.auditLog).values({
    userId: owner.userId,
    action: "settings.phonepay_updated",
    entityType: "settings",
    entityId: "sola_phonepay",
    before: { provider: before.phoneCardProvider, on: before.solaPhonePayOn, ownerOnly: before.solaPhonePayOwnerOnly, number: before.solaPhonePayNumber, backup: before.solaPhonePayBackup, digits: before.solaPhonePayDigits },
    after: { on, ownerOnly, number, backup, digits, customDigits, customCap, testNumbers, provider, tries, declines },
  });
  revalidatePath("/admin/phone/phonepay");
  return back("Saved.");
}
