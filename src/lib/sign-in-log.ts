import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { OWNER_FULL_NAME } from "@/lib/config";

/**
 * The Sign-in codes folder (Abraham, Nov 20, 2026): every code sent (who asked, by text or email, used or not) and every
 * sign-in with its sign-out time. The codes themselves are never shown (only a hash is kept).
 */
export const METHOD_WORDS: Record<string, string> = { password: "Password", sms_code: "Code by text", email_code: "Code by email", google: "Google" };

export async function codesSent(limit = 100) {
  const c = schema.loginCodes;
  const u = schema.adminUsers;
  const rows = await db
    .select({ id: c.id, createdAt: c.createdAt, channel: c.channel, usedAt: c.usedAt, expiresAt: c.expiresAt, attempts: c.attempts, name: u.name, role: u.role })
    .from(c)
    .leftJoin(u, eq(u.id, c.userId))
    .orderBy(desc(c.createdAt), desc(c.id))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    name: r.name ?? OWNER_FULL_NAME,
    by: r.channel.startsWith("email:") ? "Email" : "Text",
    status: r.usedAt ? "Used to sign in" : r.expiresAt < new Date() ? "Not used (expired)" : "Waiting",
  }));
}

/** "Chrome on Windows", "Safari on iPhone"... from the browser line, so the list stays readable. */
export function deviceWords(ua: string | null): string {
  if (!ua) return "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" on ");
}

export async function signInLog(limit = 100, now = new Date()) {
  const s = schema.signIns;
  const u = schema.adminUsers;
  const rows = await db
    .select({ id: s.id, method: s.method, signedInAt: s.signedInAt, signedOutAt: s.signedOutAt, expiresAt: s.expiresAt, endReason: s.endReason, userAgent: s.userAgent, name: u.name, role: u.role })
    .from(s)
    .leftJoin(u, eq(u.id, s.userId))
    .orderBy(desc(s.signedInAt), desc(s.id))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    name: r.name ?? OWNER_FULL_NAME,
    how: METHOD_WORDS[r.method] ?? r.method,
    device: deviceWords(r.userAgent),
    // signed out, or signed out by the Owner (deactivated / password reset), or the session ran out, or still in
    out: r.signedOutAt
      ? { at: r.signedOutAt, words: r.endReason === "revoked" ? "Signed out by the Owner" : "Signed out" }
      : r.expiresAt <= now
        ? { at: r.expiresAt, words: "Timed out" }
        : { at: null, words: "Still signed in" },
  }));
}
