"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { getSettings, saveSetting } from "@/lib/settings";
import { matchBlock, normalizePattern, parseBlockList } from "@/lib/ivr/caller-filter";

async function store(text: string, userId: number | null, before: string) {
  await saveSetting("blockedCallers", text, userId);
  await db.insert(schema.auditLog).values({ userId, action: "settings.blocked_callers_updated", entityType: "settings", entityId: "blocked_callers", before: { blockedCallers: before }, after: { blockedCallers: text } });
  revalidatePath("/admin", "layout");
  revalidatePath("/admin/calls");
}

/** Owner: save the whole block list (bad lines are refused with the reason). */
export async function saveBlockListAction(_prev: { ok?: boolean; message?: string } | null, form: FormData): Promise<{ ok?: boolean; message?: string }> {
  const owner = await requireOwner();
  const raw = String(form.get("blockedCallers") || "");
  for (const line of raw.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (!normalizePattern(line.split("|")[0].trim())) return { ok: false, message: `Not a phone number or pattern: "${line}"` };
  }
  const text = parseBlockList(raw).map((r) => (r.note ? `${r.pattern} | ${r.note}` : r.pattern)).join("\n");
  await store(text, owner.userId, (await getSettings()).blockedCallers);
  return { ok: true, message: "Saved." };
}

/** Owner: which rule (if any) would block this number. */
export async function testNumberAction(_prev: { message?: string } | null, form: FormData): Promise<{ message?: string }> {
  await requireOwner();
  const n = String(form.get("number") || "").trim();
  const rule = matchBlock(n || null, parseBlockList((await getSettings()).blockedCallers));
  return { message: rule ? `Blocked by "${rule.pattern}"${rule.note ? ` (${rule.note})` : ""}.` : "Not blocked: this caller reaches the hotline." };
}

/** Owner: one-click block from the call log. */
export async function blockCallerAction(phone: string) {
  const owner = await requireOwner();
  const pattern = normalizePattern(phone);
  if (!pattern) return;
  const before = (await getSettings()).blockedCallers;
  if (parseBlockList(before).some((r) => r.pattern === pattern)) return;
  await store([before.trim(), `${pattern} | blocked from the call log`].filter(Boolean).join("\n"), owner.userId, before);
}
