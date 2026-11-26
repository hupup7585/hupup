import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham, Nov 26, 2026, 4:07 PM: "When I click on a button, it's not clicking." Buttons that were greyed out for a
 * missing value now always respond and say in plain words what is missing. Only a save in progress greys a button. */
const FILES: [string, string][] = [
  ["src/app/admin/(app)/orders/[id]/OrderActions.tsx", "This customer has no mobile number."],
  ["src/app/admin/(app)/compliance/Forms.tsx", "Type what happened first."],
  ["src/app/admin/(app)/messages/ReplyForm.tsx", "Type a message or attach a file first."],
  ["src/app/admin/deliveries/StopActions.tsx", "Type what went wrong first."],
  ["src/app/admin/(app)/inbox/[id]/ReplyForm.tsx", "Write the message first."],
  ["src/app/admin/(app)/staff/StaffForms.tsx", "Type a password of at least 10 characters first."],
];
describe("buttons always respond", () => {
  it.each(FILES)("%s says what is missing instead of a silent grey button", (f, words) => {
    const s = readFileSync(f, "utf8");
    expect(s).toContain(words);
    expect(s).not.toMatch(/disabled=\{pending \|\| !\w+\.trim\(\)\}/);
    expect(s).not.toMatch(/disabled=\{pending \|\| \(!body\.trim\(\)/);
    expect(s).not.toMatch(/disabled=\{pending \|\| !props\.hasPhone/);
  });
  it("Sign out all other devices is never greyed out", () => {
    expect(readFileSync("src/app/admin/(app)/account/page.tsx", "utf8")).toContain('<button className="btn-ghost">Sign out all other devices</button>');
  });
});
