"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { ConfigError, discardDraft, publishDraft, saveDraft, undoLast } from "@/lib/config-versions";

/** All settings (Admin handoff Phase 2): Owner only; every action logged. Saved or Not saved, with the reason. */
async function run(key: string, fn: (userId: number | null) => Promise<unknown>, done: string) {
  const owner = await requireOwner();
  let msg = done;
  let ok = true;
  try {
    await fn(owner.userId);
  } catch (e) {
    if (!(e instanceof ConfigError)) console.error("config action failed", e);
    ok = false;
    msg = e instanceof ConfigError ? `Not saved: ${e.message}` : "Not saved: something went wrong. The live value did not change. Please try again.";
  }
  revalidatePath("/admin/config");
  redirect(`/admin/config?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}&k=${encodeURIComponent(key)}`);
}

export async function saveDraftAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  const raw = f.get("type") === "bool" ? (f.get("value") === "on" ? "on" : "off") : String(f.get("value") ?? "");
  await run(key, (u) => saveDraft(key, raw, u, String(f.get("reason") ?? "")), "Draft saved. Customers do not see it until you publish.");
}
export async function publishAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  await run(key, (u) => publishDraft(key, u, { approveWords: f.get("approveWords") === "on" }), "Published. It is live now.");
}
export async function discardAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  await run(key, (u) => discardDraft(key, u), "Draft discarded. The live value did not change.");
}
export async function undoAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  await run(key, (u) => undoLast(key, u), "The value from before is ready as a draft. Publish it to make it live.");
}
