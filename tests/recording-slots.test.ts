import { describe, expect, it, vi } from "vitest";

/* Recording slots, the voice switches and putting lines together (Abraham, Nov 15, 2026). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { allSlots, numberWords, pieces, wordSlotsFor } from "@/lib/recording-slots";
import { confirmSlot, isConfirmed, slotsWithStatus } from "@/lib/slot-status";
import { composeClips, loadPromptOverrides } from "@/lib/ivr/prompts";

describe("recording slots", () => {
  it("every fixed line, the fixed pieces of lines with changing parts, numbers, dates, times and letters A to Z", () => {
    const s = allSlots([{ id: 7, name: "Royal Castle" }]);
    expect(s.find((x) => x.key === "main_hi")?.text).toBe("Hi! Thank you for calling Hup Up Attractions!");
    expect(pieces("Your total is {total}. That is {items} for the rentals, {delivery} for delivery, and {tax} sales tax.")).toEqual(["Your total is", ". That is", "for the rentals,", "for delivery, and", "sales tax."]);
    for (const k of ["word:seven", "word:hundred", "word:dollars", "word:cents", "word:march", "word:tuesday", "word:fifth", "word:pm", "letter:a", "letter:z", "item:7"]) expect(s.some((x) => x.key === k), k).toBe(true);
  });
  it("changing parts become word slots: amounts, order numbers, dates, times; anything unknown stays in the live voice", () => {
    expect(numberWords(245)).toEqual(["two", "hundred", "forty", "five"]);
    expect(wordSlotsFor("245 dollars and 50 cents")).toEqual(["word:two", "word:hundred", "word:forty", "word:five", "word:dollars", "word:and", "word:fifty", "word:cents"]);
    expect(wordSlotsFor("1 4 3 8")).toEqual(["word:one", "word:four", "word:three", "word:eight"]);
    expect(wordSlotsFor("Tuesday, March 5th")).toEqual(["word:tuesday", "word:march", "word:fifth"]);
    expect(wordSlotsFor("3:05 PM")).toEqual(["word:three", "word:oh", "word:five", "word:pm"]);
    expect(wordSlotsFor("Royal Castle", [{ id: 7, name: "Royal Castle" }])).toEqual(["item:7"]);
    expect(wordSlotsFor("Yossi")).toBeNull();
  });
  it("status: Waiting for Abraham until he confirms; a text change sends it back to Waiting", async () => {
    expect(await isConfirmed("main_hi")).toBe(false);
    await confirmSlot("main_hi", null);
    expect(await isConfirmed("main_hi")).toBe(true);
    expect((await slotsWithStatus()).find((x) => x.key === "main_hi")?.status).toBe("confirmed");
    await db.update(schema.recordingSlots).set({ confirmedText: "an older wording" });
    expect(await isConfirmed("main_hi")).toBe(false);
  });
  it("a line with changing parts is put together only when the Owner switch is on and every part is recorded", async () => {
    const vars = { total: "15 dollars", items: "10 dollars", delivery: "5 dollars", tax: "0 dollars" };
    expect(composeClips(await loadPromptOverrides(), "checkout_total", vars)).toBeNull(); // switch off
    await db.insert(schema.appSettings).values({ key: "achirdWholeLine", value: true });
    expect(composeClips(await loadPromptOverrides(), "checkout_total", vars)).toBeNull(); // nothing recorded yet
    const keys = ["checkout_total#1", "checkout_total#2", "checkout_total#3", "checkout_total#4", "checkout_total#5", "word:fifteen", "word:ten", "word:five", "word:zero", "word:dollars"];
    let id = 1000;
    for (const k of keys) {
      const [r] = await db.insert(schema.promptRecordings).values({ promptKey: k, source: "upload", fileName: "x.mp3", contentType: "audio/mpeg", sizeBytes: 1, complete: true }).returning();
      await db.insert(schema.voicePrompts).values({ key: k, recordingId: r.id });
      id++;
    }
    const clips = composeClips(await loadPromptOverrides(), "checkout_total", vars);
    expect(clips).toHaveLength(5 + 2 + 2 + 2 + 2);
    expect(id).toBe(1010);
  });
});
