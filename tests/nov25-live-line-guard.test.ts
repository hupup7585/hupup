import { describe, expect, it, vi } from "vitest";

/* Nov 25, 2026 (stray numbers on the live line): a slot plays only a finished upload made for that slot. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { db, schema } from "@/lib/db";
import { clipUrls, loadPromptOverrides, promptAudio } from "@/lib/ivr/prompts";
import { twimlSummary } from "@/lib/ivr/twiml-log";

describe("live line guard", () => {
  it("a slot pointing at another slot's file, or an unfinished upload, plays nothing; a proper one plays", async () => {
    process.env.AUTH_SECRET = "t";
    const [fifteen] = await db.insert(schema.promptRecordings).values({ promptKey: "word:fifteen", source: "upload", fileName: "fifteen.mp3", contentType: "audio/mpeg", sizeBytes: 10, complete: true }).returning();
    const [half] = await db.insert(schema.promptRecordings).values({ promptKey: "word:six", source: "upload", fileName: "six.mp3", contentType: "audio/mpeg", sizeBytes: 10, complete: false }).returning();
    const [seven] = await db.insert(schema.promptRecordings).values({ promptKey: "word:seven", source: "upload", fileName: "seven.mp3", contentType: "audio/mpeg", sizeBytes: 10, complete: true }).returning();
    const [press] = await db.insert(schema.promptRecordings).values({ promptKey: "balloon_key_3", source: "upload", fileName: "x.mp3", contentType: "audio/mpeg", sizeBytes: 10, complete: true }).returning();
    await db.insert(schema.voicePrompts).values([
      { key: "word:two", recordingId: fifteen.id }, // wrong slot's file
      { key: "word:six", recordingId: half.id }, // unfinished
      { key: "word:seven", recordingId: seven.id }, // proper
      { key: "balloon_key_1", recordingId: press.id }, // a whole line pointing at another line's file
    ]);
    const o = await loadPromptOverrides();
    expect(clipUrls(o, ["word:two"])).toBeNull();
    expect(clipUrls(o, ["word:six"])).toBeNull();
    expect(clipUrls(o, ["word:seven"])![0]).toContain(`/api/voice-audio/prompt/${seven.id}?`);
    expect(promptAudio(o, "balloon_key_1")).toBeNull();
  });
  it("the step log names recordings by id and quotes spoken words, never long digit runs", () => {
    const xml = `<Response><Gather><Play>https://x/api/voice-audio/prompt/36?sig=abc</Play><Say voice="v">press 1.</Say><Play>https://x/audio/pause-500ms.wav</Play><Say voice="v">We have 8455550199.</Say></Gather></Response>`;
    expect(twimlSummary("balloons", xml)).toBe('[voice] balloons: rec#36 | "press 1." | ~ | "We have #####."');
  });
});
