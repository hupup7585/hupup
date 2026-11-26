"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/**
 * Owner only (Abraham, Nov 26, 2026): the after-payment Line 8 switch and the disconnect check timing. Checked on the
 * server, saved, and written to the activity log. Saved or Not saved, with the reason.
 */
export async function saveAfterPayAction(form: FormData) {
  const owner = await requireOwner();
  const minutes = Number(form.get("disconnectSilenceMinutes"));
  const seconds = Number(form.get("disconnectCheckSeconds"));
  let msg = "Saved. It is live from the next call.";
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10) msg = "Not saved: the silence time must be a whole number of minutes from 1 to 10.";
  else if (!Number.isInteger(seconds) || seconds < 1 || seconds > 15) msg = "Not saved: the wait for a key must be a whole number of seconds from 1 to 15.";
  else {
    const before = await getSettings();
    const skip = form.get("paidPromoSkipOptedIn") === "on";
    const goodbye = form.get("disconnectGoodbyeOn") === "on";
    await saveSetting("disconnectGoodbyeOn", goodbye, owner.userId);
    await saveSetting("paidPromoSkipOptedIn", skip, owner.userId);
    await saveSetting("disconnectSilenceMinutes", String(minutes), owner.userId);
    await saveSetting("disconnectCheckSeconds", String(seconds), owner.userId);
    await db.insert(schema.auditLog).values({
      userId: owner.userId,
      action: "settings.after_payment_updated",
      entityType: "settings",
      entityId: "after_payment",
      before: { disconnectGoodbyeOn: before.disconnectGoodbyeOn, paidPromoSkipOptedIn: before.paidPromoSkipOptedIn, disconnectSilenceMinutes: before.disconnectSilenceMinutes, disconnectCheckSeconds: before.disconnectCheckSeconds },
      after: { disconnectGoodbyeOn: goodbye, paidPromoSkipOptedIn: skip, disconnectSilenceMinutes: String(minutes), disconnectCheckSeconds: String(seconds) },
    });
    revalidatePath("/admin/phone/settings");
  }
  redirect(`/admin/phone/settings?ap=${encodeURIComponent(msg)}`);
}
