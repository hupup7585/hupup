import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EMAIL_SIGNATURE_DEFAULT, brandedEmail } from "@/lib/email-brand";

/* Logo and signature on every email (Abraham, Nov 17, 2026). */
describe("branded email", () => {
  it("the signature, word for word", () => {
    expect(EMAIL_SIGNATURE_DEFAULT).toBe("Thanks!\n\nHup Up Attractions\nJumping Balloons | Laser Tag | Inflatable Mazes | Paddle Boats\n(845) 777-7585 | info@hupupattractions.com | hupupattractions.com\nKiryas Joel and Orange County, NY");
  });
  it("HTML: hosted logo (no attachment) with Hup Up Attractions Inc., the message, then the signature with links; plain text too", () => {
    const e = brandedEmail("Hi Sara,\n\nThank you for your booking! <b>no tags</b>", { baseUrl: "https://hupupattractions.com" });
    expect(e.html).toContain('<img src="https://hupupattractions.com/brand/hupup-logo-h80@2x.png"');
    expect(e.html).toContain("Hup Up Attractions Inc.");
    expect(e.html).toContain("&lt;b&gt;no tags&lt;/b&gt;");
    expect(e.html).toContain('href="tel:+18457777585"');
    expect(e.html).toContain('href="mailto:info@hupupattractions.com"');
    expect(e.html).toContain('href="https://hupupattractions.com"');
    expect(e.html.indexOf("Thank you for your booking")).toBeLessThan(e.html.indexOf("Thanks!"));
    expect(e.text).toBe(`Hi Sara,\n\nThank you for your booking! <b>no tags</b>\n\n--\n${EMAIL_SIGNATURE_DEFAULT}\n`);
  });
  it("the Owner's own signature from Admin replaces the default", () => {
    expect(brandedEmail("Hello", { baseUrl: "https://x.com", signature: "Thanks,\nAbraham" }).text).toBe("Hello\n\n--\nThanks,\nAbraham\n");
  });
  it("every email goes through it, and the Owner edits the signature in Admin", () => {
    expect(readFileSync("src/lib/notify.ts", "utf8")).toContain("html: branded.html");
    expect(readFileSync("src/app/admin/(app)/settings/page.tsx", "utf8")).toContain("<EmailSignatureForm");
    expect(readFileSync("src/app/admin/(app)/settings/email-actions.ts", "utf8")).toContain("await requireOwner()");
  });
});
