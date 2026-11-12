import { describe, expect, it } from "vitest";
import { EMAIL_REPLY_TO, EMAIL_SENDER, emailEnvelope } from "@/lib/notify";

describe("email sender (Abraham, Nov 12, 2026)", () => {
  it("every email: from Hup Up Attractions <info@hupupattractions.com>, Reply-To info@", () => {
    expect(EMAIL_SENDER).toBe("Hup Up Attractions <info@hupupattractions.com>");
    expect(EMAIL_REPLY_TO).toBe("info@hupupattractions.com");
    expect(emailEnvelope("a@b.com", { EMAIL_FROM: "Hup Up Attractions <info@hupupattractions.com>" })).toEqual({ from: "Hup Up Attractions <info@hupupattractions.com>", reply_to: "info@hupupattractions.com", to: "a@b.com" });
    expect(emailEnvelope("a@b.com", {}).from).toBe(EMAIL_SENDER); // never the old resend.dev test sender
  });
  it("sendEmail is the only way the app sends email, so the Reply-To covers everything", async () => {
    const { execSync } = await import("node:child_process");
    const hits = execSync("grep -rl 'api.resend.com/emails' src || true").toString().trim().split("\n").filter(Boolean).sort();
    expect(hits).toEqual(["src/app/api/preview/email-sender-check/route.ts", "src/lib/notify.ts"]);
  });
});
