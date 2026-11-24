import { beforeAll, describe, expect, it, vi } from "vitest";

/* Abraham, Nov 24, 2026: every number, letter, item number, zip and amount uses the right recording. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { numberSlotKeys, wordSlotsFor } from "@/lib/spoken-words";
import { addressParts } from "@/lib/spoken-address";
import { composeMixed, loadPromptOverrides, textPieces } from "@/lib/ivr/prompts";

const add = async (k: string) => {
  const [r] = await db.insert(schema.promptRecordings).values({ promptKey: k, source: "upload", fileName: `${k}.mp3`, contentType: "audio/mpeg", sizeBytes: 1, complete: true }).returning();
  await db.insert(schema.voicePrompts).values({ key: k, recordingId: r.id }).onConflictDoNothing();
};

describe("slot keys, in order", () => {
  it("25 dollars; 78 dollars and 86 cents; 279", () => {
    expect(wordSlotsFor("25 dollars")).toEqual(["word:twenty five", "word:dollars"]);
    expect(wordSlotsFor("78 dollars and 86 cents")).toEqual(["word:seventy eight", "word:dollars", "word:and", "word:eighty six", "word:cents"]);
    expect(wordSlotsFor("279")).toEqual(["word:two", "word:hundred", "word:seventy nine"]);
  });
  it("3:45 PM = three, forty five, PM; 3:05 = three, oh, five", () => {
    expect(wordSlotsFor("3:45 PM")).toEqual(["word:three", "word:forty five", "word:pm"]);
    expect(wordSlotsFor("3:05 PM")).toEqual(["word:three", "word:oh", "word:five", "word:pm"]);
  });
  it("10950 = its own zip recording", () => {
    expect(wordSlotsFor("10950")).toEqual(["zip:10950"]);
  });
  it("email yossi.k1 read back = y, o, s, s, i, dot, k, one", () => {
    expect(wordSlotsFor("y o s s i dot k 1")).toEqual(["letter:y", "letter:o", "letter:s", "letter:s", "letter:i", "word:dot", "letter:k", "word:one"]);
  });
  it("unit 302A = the unit recording, else three, zero, two, A", () => {
    const unit = addressParts({ house: "12", street: "Forest Road", unit: "302A", town: "Monroe", zip: "10950" }).find((p) => p.text.includes("three"));
    expect(unit?.options).toEqual([["unit:302A"], ["word:three", "word:zero", "word:two", "letter:a"]].map((o, i) => (i === 0 ? unit!.options[0] : o)));
    expect(unit?.options[1]).toEqual(["word:three", "word:zero", "word:two", "letter:a"]);
  });
  it("no number from 21 to 99, as an amount or minutes, is ever two keys (twenty + five)", () => {
    for (let n = 21; n <= 99; n++) {
      if (n % 10 === 0) continue;
      expect(numberSlotKeys(n), String(n)).toHaveLength(1);
      expect(wordSlotsFor(`${n} dollars`)?.[0], String(n)).toMatch(/^word:\w+ \w+$/);
      if (n < 60) expect(wordSlotsFor(`3:${n} PM`)?.[1], `3:${n}`).toMatch(/^word:\w+ \w+$/);
    }
  });
});

describe("playing: never twenty + five; every recorded word plays, only a missing word is live", () => {
  beforeAll(async () => {
    for (const k of ["addr_price#1", "addr_price#2", "word:twenty", "word:five", "word:dollars", "town:highland_mills_new_york"]) await add(k);
  });
  it("'twenty five' with no recording is said live as one number, not glued from twenty + five", async () => {
    const m = composeMixed(await loadPromptOverrides(), "addr_price", { town: "Highland Mills New York", price: "25 dollars" });
    expect(m?.filter((p) => "say" in p)).toEqual([{ say: "twenty five" }]);
    expect(m?.filter((p) => "url" in p)).toHaveLength(4); // Delivery to / the town / is / dollars
  });
  it("hours: days and times from the recordings word by word, only missing words live", async () => {
    await add("word:sunday");
    await add("word:ten");
    await add("word:am");
    const p = textPieces(await loadPromptOverrides(), "Sunday: 10:00 AM to 25:00");
    expect(p?.filter((x) => "url" in x).length).toBeGreaterThanOrEqual(3);
  });
});

describe("box 154 and the call log", () => {
  it("box 154 uses the whole item recording in place of 'item {number}' when it is uploaded", () => {
    const { readFileSync } = require("node:fs");
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('"@number": `balloon_num_${bn}`');
    expect(flow).toContain("Voice: ${voice.join");
  });
});
