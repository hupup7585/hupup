import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { toE164 } from "@/lib/phone";

/* Abraham, Nov 24, 2026: "I cannot add a phone number to send a message." The Owner can start a text to any number. */
describe("Messages: New text to any number", () => {
  const page = readFileSync("src/app/admin/(app)/messages/page.tsx", "utf8");
  it("a New text box (Owner only) opens that number's conversation with the send box", () => {
    expect(page).toMatch(/staff\.role === "owner" && \(\s*<form className="mb-3 flex gap-2" data-new-text>/);
    expect(page).toContain('name="p" type="tel"');
    expect(page).toContain("No texts with this number yet. Type your message below.");
  });
  it("a typed number in any common form becomes the conversation's number; a bad one is explained", () => {
    for (const n of ["845-555-0123", "(845) 555-0123", "8455550123", "+1 845 555 0123"]) expect(toE164(n), n).toBe("+18455550123");
    expect(toE164("555-01")).toBeNull();
    expect(page).toContain("is not a valid US or Canada mobile number");
  });
});
