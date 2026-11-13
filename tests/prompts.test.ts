import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PROMPTS, fill, promptAudio, promptText, type PromptDef } from "@/lib/ivr/prompts";

describe("hotline prompts", () => {
  it("greeting is warm and uses the exact business name", () => {
    expect(PROMPTS.main_hi.text).toBe("Hi! Thank you for calling Hup Up Attractions!");
    expect(PROMPTS.main_slogan.text).toBe("Bringing something special to every occasion!");
  });
  it("are plain text (no SSML/markup) for Chirp3-HD voices", () => {
    for (const def of Object.values(PROMPTS) as PromptDef[]) expect(def.text).not.toMatch(/<[^>]+>/);
  });
  it("declare every placeholder they use", () => {
    for (const [k, def] of Object.entries(PROMPTS) as [string, PromptDef][]) {
      const used = [...def.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(used.sort(), k).toEqual([...(def.vars ?? [])].sort());
    }
  });
  it("retries are friendly", () => {
    expect(PROMPTS.no_input.text).toContain("No problem, let's try that again");
  });
  it("admin overrides replace the default; empty override falls back", () => {
    expect(promptText({ main_hi: { text: "Hello from Hup Up Attractions!", audioUrl: null } }, "main_hi")).toBe("Hello from Hup Up Attractions!");
    expect(promptText({ main_hi: { text: "  ", audioUrl: null } }, "main_hi")).toBe(PROMPTS.main_hi.text);
    expect(promptText({}, "menu_category", { category: "Jumping Balloons", key: 1 })).toBe("For Jumping Balloons, press 1.");
    expect(fill("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });
  it("recordings only replace prompts without placeholders", () => {
    expect(promptAudio({ main_hi: { text: null, audioUrl: "https://x/a.mp3" } }, "main_hi")).toBe("https://x/a.mp3");
    expect(promptAudio({ date_confirm_day: { text: null, audioUrl: "https://x/b.mp3" } }, "date_confirm_day")).toBeNull();
  });
  it("the business name is never misspelled anywhere in the source", () => {
    const bad = /h[o0]p[\s_-]?up/i;
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = path.join(dir, f);
        return statSync(p).isDirectory() ? walk(p) : [p];
      });
    const files = [...walk("src"), "README.md", "CLAUDE.md"];
    const offenders = files.filter((f) => bad.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("hotline voice", () => {
  it("defaults to Google Chirp3-HD Puck when IVR_VOICE is not set (Abraham, Nov 13, 2026)", async () => {
    const saved = process.env.IVR_VOICE;
    delete process.env.IVR_VOICE;
    const { config, DEFAULT_VOICE } = await import("@/lib/config");
    expect(DEFAULT_VOICE).toBe("Google.en-US-Chirp3-HD-Puck");
    expect(config.voice()).toBe("Google.en-US-Chirp3-HD-Puck");
    process.env.IVR_VOICE = saved;
  });
});

describe("delivery is an additional fee on the phone", () => {
  it("no prompt says the price includes delivery", () => {
    for (const [k, def] of Object.entries(PROMPTS) as [string, PromptDef][]) {
      expect(def.text, k).not.toMatch(/includes delivery|free delivery|delivery is free/i);
    }
    expect(PROMPTS.product_intro.text).toBe("Great choice! The {item} is {price}. Delivery is available for an additional fee, and our team will give you the delivery price.");
    expect(PROMPTS.cart_summary.text).toContain("plus delivery and sales tax");
  });
  it("greeting never says bounce houses", () => {
    expect(PROMPTS.main_hi.text + PROMPTS.main_slogan.text).not.toMatch(/bounce/i);
  });
});
