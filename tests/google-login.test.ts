import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Admin sign-in with Google (Abraham, Nov 16, 2026): only Google accounts saved on a staff member in Admin > Staff. */
const h = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "user-agent": "UA" }),
  cookies: async () => ({ set: (k: string, v: string) => h.cookies.set(k, v), get: (k: string) => (h.cookies.has(k) ? { value: h.cookies.get(k) } : undefined), delete: (k: string) => h.cookies.delete(k) }),
}));
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { db, schema } from "@/lib/db";
import { googleLogin } from "@/lib/auth";
import { GOOGLE_NOT_SET_UP, authorizeUrl, cleanGoogleEmail, emailFromIdToken, googleEmailForCode, googleLoginActive } from "@/lib/google-login";

const CLIENT = "client-123.apps.googleusercontent.com";
const token = (claims: Record<string, unknown>) => `x.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
const good = { iss: "https://accounts.google.com", aud: CLIENT, email: "Sara.K@gmail.com", email_verified: true, exp: Math.floor(Date.now() / 1000) + 600 };

beforeAll(async () => {
  process.env.AUTH_SECRET = "test-secret-that-is-long-enough-123";
  await db.insert(schema.adminUsers).values([
    { name: "Sara", phone: "+18457770201", role: "secretary", active: true, googleEmail: "sara.k@gmail.com" },
    { name: "Gone", phone: "+18457770202", role: "secretary", active: false, googleEmail: "gone@gmail.com" },
    { name: "Moshe", phone: "+18457770203", role: "delivery", active: true },
  ]);
});

describe("Google sign-in", () => {
  it("is free Google sign-in (openid and email only) and shows Not active yet until the key is set", () => {
    expect(googleLoginActive({})).toBe(false);
    expect(googleLoginActive({ GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "s" })).toBe(true);
    const u = new URL(authorizeUrl("https://hupup.vercel.app", "st.0", { GOOGLE_CLIENT_ID: CLIENT }));
    expect(u.host).toBe("accounts.google.com");
    expect(u.searchParams.get("scope")).toBe("openid email");
    expect(u.searchParams.get("redirect_uri")).toBe("https://hupup.vercel.app/api/auth/google/callback");
    const form = readFileSync("src/app/admin/login/LoginForm.tsx", "utf8");
    expect(form).toContain("Continue with Google");
    expect(form).toContain('data-not-active="google-login"');
    // the other ways stay
    for (const w of ["Password", "Code by email", "Code by text"]) expect(form).toContain(`"${w}"`);
  });
  it("only a verified email, from Google, for our app, not expired", () => {
    expect(emailFromIdToken(token(good), CLIENT)).toBe("sara.k@gmail.com");
    expect(emailFromIdToken(token({ ...good, aud: "someone-else" }), CLIENT)).toBeNull();
    expect(emailFromIdToken(token({ ...good, iss: "https://evil.example" }), CLIENT)).toBeNull();
    expect(emailFromIdToken(token({ ...good, email_verified: false }), CLIENT)).toBeNull();
    expect(emailFromIdToken(token({ ...good, exp: 1 }), CLIENT)).toBeNull();
    expect(emailFromIdToken("not-a-token", CLIENT)).toBeNull();
  });
  it("trades the code with Google's token endpoint (with our secret) and reads the email", async () => {
    let body = "";
    const fake = (async (_u: string, init: RequestInit) => ((body = String(init.body)), new Response(JSON.stringify({ id_token: token(good) })))) as unknown as typeof fetch;
    expect(await googleEmailForCode("abc", "https://hupup.vercel.app", { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "s" }, fake)).toBe("sara.k@gmail.com");
    expect(body).toContain("grant_type=authorization_code");
    expect(body).toContain("code=abc");
    const failing = (async () => new Response("no", { status: 400 })) as unknown as typeof fetch;
    expect(await googleEmailForCode("abc", "https://hupup.vercel.app", { GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: "s" }, failing)).toBeNull();
  });
  it("a saved Google account signs in (any capital letters); any other, or a deactivated one, is refused", async () => {
    h.cookies.clear();
    expect(await googleLogin("SARA.K@gmail.com", false)).toEqual({ ok: true, role: "secretary" });
    expect(h.cookies.has("hup_admin")).toBe(true);
    h.cookies.clear();
    expect((await googleLogin("stranger@gmail.com", false)).ok).toBe(false);
    expect((await googleLogin("gone@gmail.com", false)).ok).toBe(false);
    expect((await googleLogin("", false)).ok).toBe(false);
    expect(h.cookies.has("hup_admin")).toBe(false);
    expect(GOOGLE_NOT_SET_UP).toBe("This Google account is not set up for Admin.");
  });
  it("the Owner adds or removes it in Admin > Staff", () => {
    expect(cleanGoogleEmail(" Sara.K@Gmail.com ")).toEqual({ value: "sara.k@gmail.com" });
    expect(cleanGoogleEmail("")).toEqual({ value: null });
    expect(cleanGoogleEmail("sara").error).toBeTruthy();
    const actions = readFileSync("src/app/admin/(app)/staff/actions.ts", "utf8");
    expect(actions).toMatch(/export async function setGoogleEmailAction[\s\S]*?await requireOwner\(\)/);
    expect(readFileSync("src/app/admin/(app)/staff/StaffForms.tsx", "utf8")).toContain("data-google-email-row");
  });
  it("the callback checks the one-time state and sends a stranger back with the message", () => {
    const cb = readFileSync("src/app/api/auth/google/callback/route.ts", "utf8");
    expect(cb).toContain("sameState(state, saved)");
    expect(cb).toContain('fail("not_set_up")');
    expect(readFileSync("src/app/admin/login/page.tsx", "utf8")).toContain('g === "not_set_up" ? GOOGLE_NOT_SET_UP');
  });
});
