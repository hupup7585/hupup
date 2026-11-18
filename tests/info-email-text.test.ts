import { describe, expect, it } from "vitest";
import { INFO_ALERT_PHONE, infoEmailText } from "@/lib/inbox";

/* Every info@ email texted to 845-777-7585 with sender, subject and message (Abraham, Nov 17, 2026). */
describe("info@ email by text", () => {
  it("goes to 845-777-7585 with the sender, subject and message", () => {
    expect(INFO_ALERT_PHONE).toBe("+18457777585");
    const t = infoEmailText({ fromName: "Sara Klein", fromAddress: "sara@example.com", subject: "Bounce house for Sunday", textBody: "Hi,\r\nIs the castle free?\r\n\r\n\r\nThanks" });
    expect(t).toBe("New email to info@hupupattractions.com\nFrom: Sara Klein <sara@example.com>\nSubject: Bounce house for Sunday\n\nHi,\nIs the castle free?\n\nThanks");
  });
  it("a long email is cut to one text, pointing to the Admin inbox", () => {
    const t = infoEmailText({ fromName: null, fromAddress: "x@example.com", subject: null, textBody: "word ".repeat(1000) });
    expect(t.length).toBeLessThanOrEqual(1600);
    expect(t.endsWith("... (more in the Admin inbox)")).toBe(true);
    expect(t).toContain("Subject: (no subject)");
  });
});

/* Reply MORE 123 to get the full email by text (Abraham, Nov 18, 2026). */
describe("MORE code for the full email", () => {
  it("a cut email ends with its MORE code", () => {
    const t = infoEmailText({ id: 123, fromName: null, fromAddress: "x@example.com", subject: "Long", textBody: "word ".repeat(1000) });
    expect(t.length).toBeLessThanOrEqual(1600);
    expect(t.endsWith("... Reply MORE 123 for the full email.")).toBe(true);
    // a short email has no code
    expect(infoEmailText({ id: 5, fromName: null, fromAddress: "x@example.com", subject: "Hi", textBody: "Short" })).not.toContain("MORE");
  });
  it("the full email in numbered parts, each one text, cut at a space; very long ones point to the Admin inbox", async () => {
    const { fullEmailTexts, MORE_MAX_TEXTS } = await import("@/lib/inbox");
    const parts = fullEmailTexts({ id: 123, fromName: "Sara", fromAddress: "s@example.com", subject: "Long", textBody: "word ".repeat(700) });
    expect(parts.length).toBe(3);
    parts.forEach((p, i) => {
      expect(p.length).toBeLessThanOrEqual(1600);
      expect(p.startsWith(`Email 123, part ${i + 1} of 3\n`)).toBe(true);
    });
    expect(parts[0]).toContain("From: Sara <s@example.com>\nSubject: Long");
    expect(parts.map((p) => p.split("\n").slice(1).join("\n")).join(" ").match(/word/g)).toHaveLength(700);
    const huge = fullEmailTexts({ id: 9, fromName: null, fromAddress: "s@example.com", subject: null, textBody: "word ".repeat(5000) });
    expect(huge).toHaveLength(MORE_MAX_TEXTS);
    expect(huge[MORE_MAX_TEXTS - 1].endsWith("... (the rest is in the Admin inbox)")).toBe(true);
  });
});

