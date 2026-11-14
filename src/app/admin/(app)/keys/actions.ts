"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { config } from "@/lib/config";
import { KEYS_COOKIE, UNLOCK_MINUTES, checkCode, checkPagePassword, deleteKey, isUnlocked, lockNow, requestSetupCode, saveKey, setPagePassword } from "@/lib/api-keys";

const back = (q: Record<string, string>) => redirect(`/admin/keys?${new URLSearchParams(q).toString()}`);

/** Owner only, checked on the server for every action. */
async function who() {
  const s = await requireOwner();
  const h = await headers();
  return { userId: s.userId, ip: (h.get("x-forwarded-for") || "").split(",")[0].trim() || null, userAgent: h.get("user-agent") };
}

async function setUnlockCookie(token: string) {
  (await cookies()).set(KEYS_COOKIE, token, { httpOnly: true, secure: config.isProd(), sameSite: "strict", path: "/admin/keys", maxAge: UNLOCK_MINUTES * 60 * 6 });
}

async function unlocked() {
  const w = await who();
  const token = (await cookies()).get(KEYS_COOKIE)?.value;
  if (!(await isUnlocked(token, w.userId))) back({ m: "The page locked after 10 minutes. Please open it again." });
  return w;
}

export async function setupCodeAction() {
  const w = await who();
  let msg: Record<string, string>;
  try {
    msg = { step: "setup", m: `We emailed a 6-digit code to ${await requestSetupCode(w)}.` };
  } catch (e) {
    msg = { m: (e as Error).message };
  }
  back(msg);
}

export async function setPasswordAction(form: FormData) {
  const w = await who();
  const pw = String(form.get("pw") || "");
  if (pw !== String(form.get("pw2") || "")) back({ step: "setup", m: "The two passwords don't match." });
  const r = await setPagePassword(pw, String(form.get("code") || ""), w);
  if (!r.ok) back({ step: "setup", m: r.message });
  await setUnlockCookie(r.token!);
  back({ m: "Page password saved. The page is open." });
}

export async function passwordAction(form: FormData) {
  const w = await who();
  const r = await checkPagePassword(String(form.get("pw") || ""), w);
  back(r.ok ? { step: "code", m: r.message } : { m: r.message });
}

export async function codeAction(form: FormData) {
  const w = await who();
  const r = await checkCode(String(form.get("code") || ""), w);
  if (!r.ok) back({ m: r.message });
  await setUnlockCookie(r.token!);
  back({ m: "Opened." });
}

export async function saveKeyAction(form: FormData) {
  const w = await unlocked();
  if (form.get("confirm") !== "on") back({ m: "Tick the box to confirm." });
  let msg: string;
  try {
    const r = await saveKey(
      { name: String(form.get("name") || ""), service: String(form.get("service") || ""), purpose: String(form.get("purpose") || ""), mode: String(form.get("mode") || "test"), value: String(form.get("value") || "") },
      w,
    );
    msg = r.replaced ? "Key replaced. The old value is gone." : "Key saved.";
  } catch (e) {
    msg = (e as Error).message;
  }
  back({ m: msg });
}

export async function deleteKeyAction(form: FormData) {
  const w = await unlocked();
  if (form.get("confirm") !== "on") back({ m: "Tick the box to confirm." });
  const r = await deleteKey(String(form.get("name") || ""), String(form.get("pw") || ""), w);
  back({ m: r.message });
}

export async function lockAction() {
  await who();
  await lockNow((await cookies()).get(KEYS_COOKIE)?.value);
  back({ m: "Locked." });
}
