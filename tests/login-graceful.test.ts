import { describe, expect, it, vi } from "vitest";

// Simulates the preview bug: the database is missing a migration, so every query throws (Postgres 42703).
const dbError = Object.assign(new Error('column "time_zone" does not exist'), { code: "42703" });
vi.mock("@/lib/auth", () => ({
  sendLoginCode: vi.fn(async () => Promise.reject(dbError)),
  verifyLoginCode: vi.fn(async () => Promise.reject(dbError)),
  passwordLogin: vi.fn(async () => Promise.reject(dbError)),
  logout: vi.fn(async () => undefined),
  homeFor: () => "/admin",
}));

import { passwordAction, sendCodeAction, verifyCodeAction } from "@/app/admin/login/actions";
import { SIGNIN_UNAVAILABLE } from "@/app/admin/login/label";

describe("staff sign-in fails gracefully on a database error", () => {
  it("send code returns a message instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendCodeAction("(845) 777-7585")).resolves.toEqual({ ok: false, message: SIGNIN_UNAVAILABLE, devCode: undefined });
  });
  it("verify code and password return a message instead of throwing", async () => {
    await expect(verifyCodeAction("(845) 777-7585", "123456", false)).resolves.toEqual({ ok: false, error: SIGNIN_UNAVAILABLE });
    await expect(passwordAction("(845) 777-7585", "x".repeat(12), false)).resolves.toEqual({ ok: false, error: SIGNIN_UNAVAILABLE });
  });
});
