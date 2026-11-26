import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's Phases 1-3 review, item 15 (Nov 26, 2026): a draft saved on All settings before the setting moved to its own
 * page shows only Discard (its Publish could never work). */
describe("stale drafts on All settings", () => {
  const page = readFileSync("src/app/admin/(app)/config/page.tsx", "utf8");
  it("a draft for a setting not edited here renders only Discard, with the reason", () => {
    const stale = page.slice(page.indexOf('{draft && d.mode !== "edit" && ('), page.indexOf('{draft && d.mode === "edit" && ('));
    expect(stale).toContain("Discard (now changed on its own page)");
    expect(stale).not.toContain("publishAction");
  });
  it("Publish is offered only for settings edited here", () => {
    expect(page).toContain('{draft && d.mode === "edit" && (');
    expect(page.match(/<form action=\{publishAction\}/g)).toHaveLength(1);
  });
});

describe("L1: Publish cannot be pressed twice while it is sending", () => {
  it("All settings and Phone screens use the Saving/Publishing button", () => {
    const b = readFileSync("src/components/staff/SubmitButton.tsx", "utf8");
    expect(b).toContain("useFormStatus");
    expect(readFileSync("src/app/admin/(app)/config/page.tsx", "utf8")).toContain('<SubmitButton pendingLabel="Publishing...">Publish (make live)</SubmitButton>');
    expect(readFileSync("src/app/admin/(app)/phone/screens/DraftBanner.tsx", "utf8")).toContain('<SubmitButton pendingLabel="Publishing...">Publish (make live)</SubmitButton>');
  });
});
