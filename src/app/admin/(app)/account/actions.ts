"use server";

import { setOwnPassword } from "@/lib/auth";

export async function setOwnPasswordAction(_prev: { ok: boolean; message: string } | null, f: FormData) {
  const next = String(f.get("next") ?? "");
  if (next !== String(f.get("confirm") ?? "")) return { ok: false, message: "The two new passwords don't match." };
  return setOwnPassword(String(f.get("current") ?? ""), next);
}
