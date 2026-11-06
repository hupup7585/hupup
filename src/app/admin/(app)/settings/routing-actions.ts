"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { parseTargets } from "@/lib/ivr/routing";

/** Owner only: who rings when a caller presses 0. Validated and audited. */
export async function saveRoutingAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const targetsText = String(form.get("operatorTargets") || "").trim();
  const { targets, errors } = parseTargets(targetsText);
  if (errors.length) return { ok: false, message: errors[0] };
  if (targets.length > 10) return { ok: false, message: "Up to 10 numbers." };
  const mode = form.get("operatorMode") === "simultaneous" ? "simultaneous" : "sequential";
  const accept = form.get("operatorAcceptPrompt") === "on";
  const acceptText = String(form.get("operatorAcceptText") || "").trim().slice(0, 300);
  if (accept && !/press 1/i.test(acceptText)) return { ok: false, message: 'The accept message must tell the person to "press 1".' };
  const before = await getSettings();
  const normalized = targets.map((t) => `${t.label} | ${t.phone} | ${t.ringSeconds}`).join("\n");
  await saveSetting("operatorTargets", normalized, owner.userId);
  await saveSetting("operatorMode", mode, owner.userId);
  await saveSetting("operatorAcceptPrompt", accept, owner.userId);
  if (acceptText) await saveSetting("operatorAcceptText", acceptText, owner.userId);
  await db.insert(schema.auditLog).values({
    userId: owner.userId,
    action: "settings.routing_updated",
    entityType: "settings",
    entityId: "operator_routing",
    before: { operatorTargets: before.operatorTargets, operatorMode: before.operatorMode, operatorAcceptPrompt: before.operatorAcceptPrompt },
    after: { operatorTargets: normalized, operatorMode: mode, operatorAcceptPrompt: accept },
  });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Saved." };
}
