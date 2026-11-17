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
