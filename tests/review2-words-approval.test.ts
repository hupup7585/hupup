import { describe, expect, it, vi } from "vitest";

/* Hark's Phases 1-3 review, item 7 (Nov 26, 2026): Phone screens never publish new words without the exact-words
 * approval: a line turned on with no recording (the computer voice would read it), or a new or changed text key. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { addLine, setKey, toggleLine, type Editor } from "@/lib/ivr/menu-editor";
import { addCustomSlot } from "@/lib/custom-slots";
import { editScreenDraft, newWordsInDraft, publishScreens } from "@/lib/screen-drafts";

const WORDS = "Ask about our winter special.";

describe("exact-words approval on Phone screens", () => {
  it("a new line turned on with no recording: refused without the tick, allowed with it, the words kept in the activity log", async () => {
    const r = await addCustomSlot({ name: "Winter special", group: "Menu lines", text: WORDS, lookup: "menu winter special" }, [], 1);
    expect(r.ok).toBe(true);
    const ref = (r as { key: string }).key;
    await editScreenDraft("menu", 1, "phone.screen_line_added", (e) => addLine(e, { layout: "book" }, ref));
    await editScreenDraft("menu", 1, "phone.screen_line_switched", (e: Editor) => toggleLine(e, { layout: "book" }, e.layouts.book.findIndex((l) => l.ref === ref), true));
    expect((await newWordsInDraft()).map((w) => w.words)).toEqual([WORDS]);
    await expect(publishScreens(1, "add the special")).rejects.toThrow(/I approve these exact words/);
    await publishScreens(1, "add the special", { approveWords: true });
    const [row] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "phone.screens_words_approved_published"));
    expect(JSON.stringify(row.after)).toContain(WORDS);
  });
  it("a recorded line needs no tick", async () => {
    await editScreenDraft("menu", 1, "x", (e: Editor) => toggleLine(e, { layout: "book" }, 0, !e.layouts.book[0].on));
    // the built line is turned off (or back on, it is a live line already): no new unrecorded words that were not live
    const words = await newWordsInDraft();
    expect(words.every((w) => w.kind === "line")).toBe(true);
  });
  it("a new Send a text key needs the tick too", async () => {
    await editScreenDraft("menu", 1, "x", (e: Editor) => {
      const r = setKey(e, "menu", { key: "9", on: true, action: { type: "text", text: "Our catalog: hupupattractions.com" } });
      return r;
    });
    expect((await newWordsInDraft()).some((w) => w.kind === "text" && w.words.includes("Our catalog"))).toBe(true);
    await expect(publishScreens(1, "text key")).rejects.toThrow(/exact words/);
    await publishScreens(1, "text key", { approveWords: true });
  });
});
