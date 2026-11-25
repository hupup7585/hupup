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

/** Batch 4 item 14 (Abraham, Nov 25, 2026): sign out every other phone or computer; this one stays signed in. */
export async function signOutOtherDevicesAction() {
  const { currentStaff } = await import("@/lib/auth");
  const { db, schema } = await import("@/lib/db");
  const { and, eq, ne } = await import("drizzle-orm");
  const { redirect } = await import("next/navigation");
  const me = await currentStaff();
  if (!me || !me.userId) return redirect("/admin/login");
  const gone = await db.delete(schema.adminSessions).where(and(eq(schema.adminSessions.userId, me.userId), ne(schema.adminSessions.id, me.sessionId))).returning({ id: schema.adminSessions.id });
  await db.insert(schema.auditLog).values({ userId: me.userId, action: "auth.signed_out_other_devices", entityType: "admin_user", entityId: String(me.userId), after: { devices: gone.length } });
  redirect(`/admin/account?others=${gone.length}#devices`);
}
