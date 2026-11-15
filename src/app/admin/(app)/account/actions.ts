"use server";

import { setOwnPassword } from "@/lib/auth";

export async function setOwnPasswordAction(_prev: { ok: boolean; message: string } | null, f: FormData) {
  const next = String(f.get("next") ?? "");
  if (next !== String(f.get("confirm") ?? "")) return { ok: false, message: "The two new passwords don't match." };
  return setOwnPassword(String(f.get("current") ?? ""), next);
}

/** "My preferred sign-in way" (Abraham, Nov 14, 2026): remembered on this device, so the sign-in page opens on it. */
export async function setSignInWayAction(f: FormData) {
  const { requireAdmin } = await import("@/lib/auth");
  const { cookies } = await import("next/headers");
  const { redirect } = await import("next/navigation");
  await requireAdmin();
  const w = String(f.get("way") ?? "");
  const way = w === "email" || w === "sms" ? w : "password";
  (await cookies()).set("hup_signin_way", way, { path: "/admin", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: false });
  redirect("/admin/account?saved=way");
}
