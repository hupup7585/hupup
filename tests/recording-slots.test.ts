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
import { composeClips, composeMixed, loadPromptOverrides } from "@/lib/ivr/prompts";

describe("recording slots", () => {
  it("every fixed line, the fixed pieces of lines with changing parts, numbers, dates, times and letters A to Z", () => {
    const s = allSlots([{ id: 7, name: "Royal Castle" }]);
    expect(s.find((x) => x.key === "greeting")?.text).toBe("Hi, thank you for calling Hup Up Attractions! Bringing something special to every occasion!");
    expect(pieces("Your total is {total}. That is {items} for the rentals, {delivery} for delivery, and {tax} sales tax.")).toEqual(["Your total is", ". That is", "for the rentals,", "for delivery, and", "sales tax."]);
    for (const k of ["word:seven", "word:hundred", "word:dollars", "word:cents", "word:march", "word:tuesday", "word:fifth", "word:pm", "letter:a", "letter:z", "item:7"]) expect(s.some((x) => x.key === k), k).toBe(true);
  });
  it("changing parts become word slots: amounts, order numbers, dates, times; anything unknown stays in the live voice", () => {
    expect(numberWords(245)).toEqual(["two", "hundred", "forty", "five"]);
    // Nov 23, 2026 (Abraham): 21 to 99 one recording each ("forty five"), the six zips one recording each
    expect(wordSlotsFor("245 dollars and 50 cents")).toEqual(["word:two", "word:hundred", "word:forty five", "word:dollars", "word:and", "word:fifty", "word:cents"]);
    expect(wordSlotsFor("88")).toEqual(["word:eighty eight"]);
    expect(wordSlotsFor("12")).toEqual(["word:twelve"]);
    expect(wordSlotsFor("10950")).toEqual(["zip:10950"]);
    expect(wordSlotsFor("10930")).toEqual(["zip:10930"]);
    expect(wordSlotsFor("10941")).toEqual(["word:one", "word:zero", "word:nine", "word:four", "word:one"]); // another zip: digit by digit
    expect(wordSlotsFor("1 4 3 8")).toEqual(["word:one", "word:four", "word:three", "word:eight"]);
    expect(wordSlotsFor("Tuesday, March 5th")).toEqual(["word:tuesday", "word:march", "word:fifth"]);
    expect(wordSlotsFor("3:05 PM")).toEqual(["word:three", "word:oh", "word:five", "word:pm"]);
    expect(wordSlotsFor("Royal Castle", [{ id: 7, name: "Royal Castle" }])).toEqual(["item:7"]);
    expect(wordSlotsFor("Yossi")).toBeNull();
  });
  it("status: Waiting for Abraham until he confirms; a text change sends it back to Waiting", async () => {
    expect(await isConfirmed("greeting")).toBe(false);
    await confirmSlot("greeting", null);
    expect(await isConfirmed("greeting")).toBe(true);
    expect((await slotsWithStatus()).find((x) => x.key === "greeting")?.status).toBe("confirmed");
    await db.update(schema.recordingSlots).set({ confirmedText: "an older wording" });
    expect(await isConfirmed("greeting")).toBe(false);
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
  it("Nov 23, 2026: every recorded piece plays; only a piece with no recording is said by the live voice", async () => {
    const add = async (k: string) => {
      const [r] = await db.insert(schema.promptRecordings).values({ promptKey: k, source: "upload", fileName: `${k}.mp3`, contentType: "audio/mpeg", sizeBytes: 1, complete: true }).returning();
      await db.insert(schema.voicePrompts).values({ key: k, recordingId: r.id }).onConflictDoNothing();
    };
    // "Delivery to {town} is {price}." with the pieces, the town and "dollars" recorded, but not "eighty eight" yet
    for (const k of ["addr_price#1", "addr_price#2", "town:highland_mills_new_york"]) await add(k);
    let m = composeMixed(await loadPromptOverrides(), "addr_price", { town: "Highland Mills New York", price: "88 dollars" });
    expect(m?.filter((p) => "url" in p)).toHaveLength(4); // Delivery to / the town / is / dollars
    expect(m?.filter((p) => "say" in p)).toEqual([{ say: "eighty eight" }]); // only the missing number
    await add("word:eighty eight");
    m = composeMixed(await loadPromptOverrides(), "addr_price", { town: "Highland Mills New York", price: "88 dollars" });
    expect(m?.every((p) => "url" in p)).toBe(true); // nothing in the live voice
    expect(m).toHaveLength(5);
    // a zip: the one-piece recording
    await add("zip:10930");
    expect(composeMixed(await loadPromptOverrides(), "addr_price", { town: "Highland Mills New York", price: "10930" })?.every((p) => "url" in p)).toBe(true);
  });
});
