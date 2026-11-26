import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Hark's Phases 1-3 review, item 13 (Nov 26, 2026): two Phone screens edits made at the same moment both survive. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { defaultLayout, toggleLine, type Editor } from "@/lib/ivr/menu-editor";
import { draftEditor, editScreenDraft } from "@/lib/screen-drafts";

describe("draft edits at the same moment", () => {
  it("two concurrent toggles on different lines both survive", async () => {
    const lines = defaultLayout("book");
    expect(lines.length).toBeGreaterThan(2);
    const off = (i: number) => (e: Editor) => toggleLine(e, { layout: "book" }, i, false);
    await Promise.all([editScreenDraft("book", 1, "phone.screen_line_switched", off(0)), editScreenDraft("book", 1, "phone.screen_line_switched", off(1))]);
    const d = (await draftEditor())!;
    const lay = d.layouts.book;
    expect(lay[0].on).toBe(false);
    expect(lay[1].on).toBe(false);
  });
  it("a refused change saves nothing", async () => {
    const before = await draftEditor();
    const r = await editScreenDraft("book", 1, "x", () => ({ error: "nope" }));
    expect(r).toEqual({ error: "nope" });
    expect(await draftEditor()).toEqual(before);
  });
  it("every screen action uses the locked edit", () => {
    const a = readFileSync("src/app/admin/(app)/phone/screens/actions.ts", "utf8");
    expect(a).not.toContain("await read()");
    expect(a.match(/await edit\(screen, o\.userId,/g)!.length).toBeGreaterThanOrEqual(6);
    expect(readFileSync("src/lib/screen-drafts.ts", "utf8")).toContain('.for("update")');
  });
});
