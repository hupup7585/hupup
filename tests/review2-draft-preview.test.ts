import { describe, expect, it, vi } from "vitest";

/* Hark's Phases 1-3 review, item 8 (Nov 26, 2026): Test this screen shows Draft next to Live; nothing is saved. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";
import { PROMPTS } from "@/lib/ivr/prompts";
import { defaultLayout, toggleLine, EMPTY_EDITOR, type Editor } from "@/lib/ivr/menu-editor";
import { changedSteps, previewScreen } from "@/lib/ivr/screen-preview";

describe("Test this screen: Live and Draft", () => {
  it("a draft that turns a line off shows it gone in Draft and still present in Live; no rows written", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    const base: Editor = { ...EMPTY_EDITOR, layouts: { book: defaultLayout("book") } };
    const i = base.layouts.book.findIndex((l) => l.ref === "book_r2");
    expect(i).toBeGreaterThan(-1);
    const draft = toggleLine(base, { layout: "book" }, i, false);
    const before = (await db.select().from(schema.callSessions)).length;
    const p = (await previewScreen("book", draft))!;
    const said = (steps: { text: string }[]) => steps.map((s) => s.text).join("\n");
    const words = PROMPTS.book_r2.text.slice(0, 30);
    expect(said(p.steps)).toContain(words);
    expect(said(p.draft!.steps)).not.toContain(words);
    const d = changedSteps(p.steps, p.draft!.steps);
    expect(d.onlyA.size).toBeGreaterThan(0);
    expect((await db.select().from(schema.callSessions)).length).toBe(before);
  });
  it("a real call can never use another set of screens (only preview calls)", async () => {
    const off: Editor = { ...EMPTY_EDITOR, layouts: { book: defaultLayout("book").map((l) => ({ ...l, on: false })) } };
    const real = await handleVoice({ action: "book", query: new URLSearchParams(), body: { CallSid: "CAREAL" }, callSid: "CAREAL", from: "+18455550199", editorOverride: off });
    expect(real).toContain(PROMPTS.book_r2.text.slice(0, 30).replace(/'/g, "&apos;"));
  });
});
