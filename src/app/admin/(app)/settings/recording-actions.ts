"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";

/** Owner only: call recording on/off. Turning it on needs the Owner to approve the notice wording. Audited. */
export async function saveRecordingAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const on = form.get("callRecording") === "on";
  if (on && form.get("approveNotice") !== "on") return { ok: false, message: "To turn recording on, first approve the notice wording above." };
  const before = (await getSettings()).callRecording;
  await saveSetting("callRecording", on, owner.userId);
  await db.insert(schema.auditLog).values({ userId: owner.userId, action: "settings.call_recording_updated", entityType: "settings", entityId: "call_recording", before: { callRecording: before }, after: { callRecording: on } });
  revalidatePath("/admin", "layout");
  return { ok: true, message: on ? "Call recording is ON. Every call now hears the notice first." : "Call recording is OFF." };
}
