"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { homeFor, logout, passwordLogin, sendLoginCode, sendLoginEmailCode, verifyLoginCode } from "@/lib/auth";
import { config } from "@/lib/config";
import { SIGNIN_UNAVAILABLE } from "./label";

/** A database or provider error must never crash the sign-in page: log it, show a plain message. */
async function safely<T>(where: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    unstable_rethrow(e); // let redirect() through
    console.error(`[staff sign-in] ${where} failed:`, e);
    return fallback;
  }
}

export async function sendCodeAction(phone: string) {
  return safely(
    "send code",
    async () => {
      const r = await sendLoginCode(phone);
      // Only expose the code when running locally without an SMS provider.
      return { ok: r.ok, message: r.message, devCode: config.isProd() ? undefined : r.devCode };
    },
    { ok: false, message: SIGNIN_UNAVAILABLE, devCode: undefined as string | undefined },
  );
}

/** Owner only: the sign-in code by email (always to the business Gmail). */
export async function sendEmailCodeAction(phone: string) {
  return safely(
    "send email code",
    async () => {
      const r = await sendLoginEmailCode(phone);
      return { ok: r.ok, message: r.message, devCode: config.isProd() ? undefined : r.devCode };
    },
    { ok: false, message: SIGNIN_UNAVAILABLE, devCode: undefined as string | undefined },
  );
}

export async function verifyCodeAction(phone: string, code: string, trust: boolean, via: "sms" | "email" = "sms") {
  const r = await safely("verify code", () => verifyLoginCode(phone, code, trust, via), { ok: false, error: SIGNIN_UNAVAILABLE, role: undefined });
  if (!r.ok || !r.role) return { ok: false, error: r.error };
  redirect(homeFor(r.role));
}

export async function passwordAction(phone: string, password: string, trust: boolean) {
  const r = await safely("password", () => passwordLogin(phone, password, trust), { ok: false, error: SIGNIN_UNAVAILABLE, role: undefined });
  if (!r.ok || !r.role) return { ok: false, error: r.error };
  redirect(homeFor(r.role));
}

export async function logoutAction() {
  await safely("sign out", () => logout(), undefined);
  redirect("/admin/login");
}
