"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { ConfigError, discardDraft, publishDraft, saveDraft, undoLast } from "@/lib/config-versions";
import type { OkCode } from "./messages";

/** All settings (Admin handoff Phase 2): Owner only; every action logged. Saved or Not saved, with the reason. */
async function run(key: string, fn: (userId: number | null) => Promise<unknown>, done: OkCode) {
  const owner = await requireOwner();
  let msg = "";
  let ok = true;
  try {
    await fn(owner.userId);
  } catch (e) {
    if (!(e instanceof ConfigError)) console.error("config action failed", e);
    ok = false;
    msg = e instanceof ConfigError ? `Not saved: ${e.message}` : "Not saved: something went wrong. The live value did not change. Please try again.";
  }
  // A published setting can change the website and every Admin page (Hark's review M11)
  revalidatePath("/", "layout");
  revalidatePath("/admin", "layout");
  // Success is a message code, never free text in the address (Hark's review L11)
  redirect(ok ? `/admin/config?ok=${done}&k=${encodeURIComponent(key)}` : `/admin/config?err=${encodeURIComponent(msg)}&k=${encodeURIComponent(key)}`);
}

export async function saveDraftAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  const raw = f.get("type") === "bool" ? (f.get("value") === "on" ? "on" : "off") : String(f.get("value") ?? "");
  await run(key, (u) => saveDraft(key, raw, u, String(f.get("reason") ?? "")), "draft");
}
export async function publishAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  const version = Number(f.get("version"));
  await run(key, (u) => publishDraft(key, version, u, { approveWords: f.get("approveWords") === "on" }), "published");
}
export async function discardAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  const version = Number(f.get("version"));
  await run(key, (u) => discardDraft(key, version, u), "discarded");
}
export async function undoAction(f: FormData) {
  const key = String(f.get("key") ?? "");
  await run(key, (u) => undoLast(key, u), "undo");
}
