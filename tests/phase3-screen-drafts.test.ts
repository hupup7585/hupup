import { describe, expect, it, vi } from "vitest";

/* Admin handoff Phase 3 (Nov 26, 2026; Hark's review M13): phone screen changes are drafts until the Owner publishes;
 * callers keep the live screens; publish is recorded in the history with the reason; undo makes the version before a
 * new draft; discard leaves the live screens as they were. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { toggleLine } from "@/lib/ivr/menu-editor";
import { ScreenDraftError, discardScreens, draftChanges, draftEditor, editingEditor, liveEditor, publishScreens, saveScreenDraft, undoScreens } from "@/lib/screen-drafts";
import { configHistory } from "@/lib/config-versions";

const live = async () => {
  const [r] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "screenEditor"));
  return r?.value ?? null;
};

describe("phone screens, draft first", () => {
  it("an edit goes to the draft; the phone keeps reading the live screens", async () => {
    const before = await editingEditor();
    const after = toggleLine(before, { screen: "menu" }, 0, false);
    await saveScreenDraft("menu", before, after, 1, "phone.screen_line_switched");
    expect(await live()).toBeNull(); // callers: unchanged
    expect(await draftEditor()).toEqual(after);
    expect(await editingEditor()).toEqual(after); // the Admin page shows the draft
    expect(await draftChanges()).toEqual(["menu"]);
  });
  it("publish needs a reason; then the draft is live, the draft is cleared, and the version is in the history", async () => {
    await expect(publishScreens(1, "")).rejects.toBeInstanceOf(ScreenDraftError);
    const draft = await draftEditor();
    await publishScreens(1, "greeting off for testing");
    expect(await liveEditor()).toEqual(draft);
    expect(await draftEditor()).toBeNull();
    const [v] = await configHistory("screenEditor");
    expect(v).toMatchObject({ status: "live", reason: "greeting off for testing", publishedBy: 1 });
  });
  it("undo makes the screens from before into a draft; publishing it restores them", async () => {
    await undoScreens(1);
    expect(await draftChanges()).toEqual(["menu"]);
    await expect(undoScreens(1)).rejects.toThrow("draft changes waiting");
    await publishScreens(1, "undo the test");
    expect((await liveEditor()).layouts).toEqual({});
  });
  it("discard throws the draft away and leaves the live screens as they were", async () => {
    const e = await editingEditor();
    await saveScreenDraft("book", e, toggleLine(e, { screen: "book" }, 0, false), 1, "x");
    const liveBefore = await live();
    await discardScreens(1);
    expect(await draftEditor()).toBeNull();
    expect(await live()).toEqual(liveBefore);
    await expect(discardScreens(1)).rejects.toThrow("no draft changes");
  });
  it("the Admin pages show the draft banner and every edit action saves to the draft", () => {
    expect(readFileSync("src/app/admin/(app)/phone/screens/[id]/page.tsx", "utf8")).toContain("<DraftBanner screen={id} />");
    expect(readFileSync("src/app/admin/(app)/phone/screens/page.tsx", "utf8")).toContain("<DraftBanner />");
    const actions = readFileSync("src/app/admin/(app)/phone/screens/actions.ts", "utf8");
    expect(actions).toContain("editScreenDraft("); // the locked edit (review item 13)
    expect(actions).not.toMatch(/insert\(schema\.appSettings\)/);
  });
});
