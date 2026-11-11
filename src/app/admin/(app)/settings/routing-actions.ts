"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting, type Settings } from "@/lib/settings";
import { RING_KEYS, parseTargets, type RingKey } from "@/lib/ivr/routing";

/** Setting names for each key's ring list (key 0 is the operator list). */
function names(k: RingKey) {
  return k === "0"
    ? ({ targets: "operatorTargets", mode: "operatorMode", accept: "operatorAcceptPrompt" } as const)
    : ({ targets: `ringTargets${k}`, mode: `ringMode${k}`, accept: `ringAccept${k}` } as const);
}

/** Owner only: who rings for a main-menu key (2, 4, 5, 6, 8 or 0). Validated and audited. */
export async function saveRoutingAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const k = String(form.get("ringKey") || "0") as RingKey;
  if (!(RING_KEYS as readonly string[]).includes(k)) return { ok: false, message: "Unknown menu key." };
  const n = names(k);
  const { targets, errors } = parseTargets(String(form.get("targets") || "").trim());
  if (errors.length) return { ok: false, message: errors[0] };
  if (targets.length > 10) return { ok: false, message: "Up to 10 numbers." };
  const mode = form.get("mode") === "simultaneous" ? "simultaneous" : "sequential";
  const accept = form.get("accept") === "on";
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const before = await getSettings();
  const normalized = targets.map((t) => `${t.label} | ${t.phone} | ${t.ringSeconds}`).join("\n");
  await saveSetting(n.targets as keyof Settings, normalized as never, owner.userId);
  await saveSetting(n.mode as keyof Settings, mode as never, owner.userId);
  await saveSetting(n.accept as keyof Settings, accept as never, owner.userId);
  await saveSetting(`ringName${k}` as keyof Settings, name as never, owner.userId);
  await db.insert(schema.auditLog).values({
    userId: owner.userId,
    action: "settings.routing_updated",
    entityType: "settings",
    entityId: `ring_key_${k}`,
    before: { targets: before[n.targets], mode: before[n.mode], accept: before[n.accept], name: before[`ringName${k}` as keyof Settings] },
    after: { targets: normalized, mode, accept, name },
  });
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Saved." };
}
