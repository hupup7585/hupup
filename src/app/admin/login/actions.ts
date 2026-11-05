"use server";

import { redirect } from "next/navigation";
import { homeFor, logout, passwordLogin, sendLoginCode, verifyLoginCode } from "@/lib/auth";
import { config } from "@/lib/config";

export async function sendCodeAction(phone: string) {
  const r = await sendLoginCode(phone);
  // Only expose the code when running locally without an SMS provider.
  return { ok: r.ok, message: r.message, devCode: config.isProd() ? undefined : r.devCode };
}

export async function verifyCodeAction(phone: string, code: string, trust: boolean) {
  const r = await verifyLoginCode(phone, code, trust);
  if (!r.ok || !r.role) return { ok: false, error: r.error };
  redirect(homeFor(r.role));
}

export async function passwordAction(phone: string, password: string, trust: boolean) {
  const r = await passwordLogin(phone, password, trust);
  if (!r.ok || !r.role) return { ok: false, error: r.error };
  redirect(homeFor(r.role));
}

export async function logoutAction() {
  await logout();
  redirect("/admin/login");
}
