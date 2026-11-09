import { describe, expect, it } from "vitest";
import { voicemailPlayLink, verifyVoicemailLink } from "@/lib/signed-link";

/* Private play links in voicemail alerts: signed, expire, can't be changed to another message. */
describe("voicemail play link", () => {
  it("works until it expires; a changed id or signature is refused", () => {
    process.env.AUTH_SECRET = "test-secret-that-is-long-enough-123";
    const now = Date.UTC(2026, 10, 9, 20);
    const u = new URL(voicemailPlayLink(42, 14, now));
    const exp = u.searchParams.get("exp"), sig = u.searchParams.get("sig");
    expect(u.pathname).toBe("/api/voicemail/play/42");
    expect(verifyVoicemailLink(42, exp, sig, now)).toBe(true);
    expect(verifyVoicemailLink(43, exp, sig, now)).toBe(false);
    expect(verifyVoicemailLink(42, exp, "0".repeat(32), now)).toBe(false);
    expect(verifyVoicemailLink(42, exp, sig, now + 15 * 86_400_000)).toBe(false);
  });
});
