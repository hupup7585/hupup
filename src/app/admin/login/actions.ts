"use server";

import { redirect } from "next/navigation";
import { sendLoginCode, verifyLoginCode, logout, type Channel } from "@/lib/auth";
import { config } from "@/lib/config";

export async function sendCodeAction(channel: Channel) {
  const r = await sendLoginCode(channel);
  // Only expose the code when running locally without SMS/email providers.
  return { ok: r.ok, error: r.error, devCode: config.isProd() ? undefined : r.devCode };
}

export async function verifyCodeAction(code: string, trust: boolean) {
  const r = await verifyLoginCode(code, trust);
  if (!r.ok) return r;
  redirect("/admin");
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}
