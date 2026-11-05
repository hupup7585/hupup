"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { requireOwner } from "@/lib/auth";
import { db, schema } from "@/lib/db";
import { PROMPTS, type PromptKey } from "@/lib/ivr/prompts";

export async function savePromptAction(key: string, text: string): Promise<{ ok: boolean; message: string }> {
  await requireOwner();
  if (!(key in PROMPTS)) return { ok: false, message: "Unknown prompt" };
  const clean = text.trim();
  if (/<[^>]+>/.test(clean)) return { ok: false, message: "Plain text only: the hotline voice doesn't support tags or SSML." };
  if (clean.length > 600) return { ok: false, message: "Please keep prompts under 600 characters." };
  const def = PROMPTS[key as PromptKey] as { vars?: string[] };
  const missing = (def.vars ?? []).filter((v) => !clean.includes(`{${v}}`));
  if (clean && missing.length) return { ok: false, message: `Keep these placeholders in the text: ${missing.map((m) => `{${m}}`).join(", ")}` };
  if (!clean) {
    await db.delete(schema.voicePrompts).where(eq(schema.voicePrompts.key, key));
  } else {
    await db
      .insert(schema.voicePrompts)
      .values({ key, text: clean })
      .onConflictDoUpdate({ target: schema.voicePrompts.key, set: { text: clean, updatedAt: new Date() } });
  }
  revalidatePath("/admin/phone/prompts");
  return { ok: true, message: clean ? "Saved — callers hear this right away." : "Reset to the default wording." };
}
