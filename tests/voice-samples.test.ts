import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { VOICE_SAMPLE_TEXT, VOICE_SAMPLE_VOICES, makeVoiceSamples, sampleFileName, voiceSamples } from "@/lib/voice-samples";

describe("voice samples (listening only)", () => {
  it("all 16 Chirp 3 HD male voices, Abraham's exact text, files named by voice", () => {
    expect(VOICE_SAMPLE_VOICES).toHaveLength(16);
    expect(new Set(VOICE_SAMPLE_VOICES).size).toBe(16);
    expect(VOICE_SAMPLE_TEXT).toBe("Hi! Thank you for calling Hup Up Attractions! Bringing something special to every occasion! If you know your desired extension, you may press it at any time.");
    expect(sampleFileName("en-US-Chirp3-HD-Sadachbia")).toBe("voice-sample-sadachbia.mp3");
    expect(VOICE_SAMPLE_TEXT.length * 16).toBeLessThan(3000);
  });
  it("Not active yet without Google Text-to-Speech; with it, one sample per voice, made once; IVR_VOICE untouched", async () => {
    delete process.env.GOOGLE_TTS_API_KEY;
    expect(await makeVoiceSamples(null)).toBeNull();
    process.env.GOOGLE_TTS_API_KEY = "test";
    process.env.IVR_VOICE = "Google.en-US-Chirp3-HD-Fenrir";
    const asked: string[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      asked.push(b.voice.name);
      expect(b.input.text).toBe(VOICE_SAMPLE_TEXT);
      return new Response(JSON.stringify({ audioContent: Buffer.from("ID3fake-mp3").toString("base64") }));
    }) as unknown as typeof fetch;
    expect(await makeVoiceSamples(null, fake)).toBe(16);
    expect(asked).toEqual([...VOICE_SAMPLE_VOICES]);
    expect(await makeVoiceSamples(null, fake)).toBe(0); // not made twice
    const list = await voiceSamples();
    expect(list.every((s) => s.recording && s.recording.fileName === s.fileName)).toBe(true);
    expect(process.env.IVR_VOICE).toBe("Google.en-US-Chirp3-HD-Fenrir");
    delete process.env.GOOGLE_TTS_API_KEY;
    delete process.env.IVR_VOICE;
  });
});
