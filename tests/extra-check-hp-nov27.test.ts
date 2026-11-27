import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Extra check HP (Nov 27, 2026): Admin phone recordings and prompts, uploads, hours. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/notify", () => ({ sendEmail: async () => ({ sent: true }), sendSms: async () => ({ sent: true }) }));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

describe("HP1: an old laser upload chosen for laser part 1 is played", () => {
  it("loadPromptOverrides keeps it", async () => {
    const [rec] = await db.insert(schema.promptRecordings).values({ promptKey: "instr_laser", source: "upload", fileName: "laser.mp3", contentType: "audio/mpeg", sizeBytes: 10, complete: true } as never).returning();
    await db.insert(schema.voicePrompts).values({ key: "instr_laser_1", recordingId: rec.id } as never);
    const { loadPromptOverrides } = await import("@/lib/ivr/prompts");
    const o = await loadPromptOverrides();
    expect(o.instr_laser_1?.recordingId).toBe(rec.id);
  });
});

describe("HP4 + HP7: approving wording", () => {
  it("two approvals at once leave one live version; an uploaded recording on the line is reported", async () => {
    const { approveDraft, saveDraft, versionsFor } = await import("@/lib/prompt-versions");
    const key = "office_closed";
    const d = await saveDraft(key, "Our office is closed right now, but you can still book anytime with our automated system.", 1);
    const rs = await Promise.allSettled([approveDraft(d.id, 1), approveDraft(d.id, 1)]);
    expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const v = await versionsFor(key);
    expect(v.filter((x) => x.status === "live")).toHaveLength(1);
    expect(v.filter((x) => x.note === "Original wording")).toHaveLength(1);
    const [rec] = await db.insert(schema.promptRecordings).values({ promptKey: key, source: "upload", fileName: "o.mp3", contentType: "audio/mpeg", sizeBytes: 10, complete: true } as never).returning();
    await db.update(schema.voicePrompts).set({ recordingId: rec.id }).where(eq(schema.voicePrompts.key, key));
    const d2 = await saveDraft(key, "Our office is closed now, but you can still book anytime using our automated system.", 1);
    const r = await approveDraft(d2.id, 1);
    expect(r.hasUpload).toBe(true);
    expect(readFileSync("src/app/admin/(app)/phone/prompts/actions.ts", "utf8")).toContain("still plays (with the old words)");
  });
});

describe("HP6: an older recording keeps the 'Needs a new recording' flag", () => {
  it("only a recording made after the change clears it", async () => {
    const { clearRecordingFlag, linkedValueChanged, recordingFlags } = await import("@/lib/recording-flags");
    const { getSettings } = await import("@/lib/settings");
    await linkedValueChanged("product:Ocean balls:2", 1500, 1700);
    const flagged = async () => recordingFlags((await getSettings()) as never).some((f) => f.slot === "ocean_500");
    expect(await flagged()).toBe(true);
    await clearRecordingFlag("ocean_500", null, new Date(Date.now() - 3600_000));
    expect(await flagged()).toBe(true);
    await clearRecordingFlag("ocean_500", null, new Date(Date.now() + 1000));
    expect(await flagged()).toBe(false);
  });
});

describe("HP5: Hours save flags only on customer service hours", () => {
  it("hoursSchedules is not flagged by the generic save; the Hours page flags key7 and book_r3c from the words", async () => {
    const { defaultLinks } = await import("@/lib/recording-flags");
    expect(defaultLinks().find((l) => l.source === "setting:hoursSchedules")!.slots).toEqual(["key7_cs_hours", "book_r3c"]);
    expect(readFileSync("src/lib/settings.ts", "utf8")).toContain('key !== "hoursSchedules"');
    expect(readFileSync("src/app/admin/(app)/hours/actions.ts", "utf8")).toContain('scheduleWords(effectiveLine(d, "cs").schedule)');
  });
});

describe("HP3: promo picture originals", () => {
  it("extra pieces after the original is complete, a bad piece number, or a piece past its size are refused", async () => {
    const { saveOriginalChunk } = await import("@/lib/promo-pictures");
    const [p] = await db.insert(schema.promoPictures).values({ token: "t-hp3", source: "upload", jpg: Buffer.from([0xff, 0xd8, 0xff]), jpgBytes: 3, width: 1, height: 1, originalBytes: 4, originalComplete: false } as never).returning();
    await expect(saveOriginalChunk(p.id, Number.NaN, Buffer.from([1]), false)).rejects.toThrow();
    await expect(saveOriginalChunk(p.id, 0, Buffer.from([1, 2, 3, 4, 5]), true)).rejects.toThrow();
    expect(await saveOriginalChunk(p.id, 0, Buffer.from([1, 2, 3, 4]), true)).toEqual({ complete: true });
    expect(await saveOriginalChunk(p.id, 1, Buffer.from([9]), true)).toEqual({ complete: true });
    const chunks = await db.select().from(schema.promoPictureChunks).where(and(eq(schema.promoPictureChunks.pictureId, p.id)));
    expect(chunks).toHaveLength(1);
  });
});

describe("HP2, HP8, HP9, HP10: code checks", () => {
  it("music counted in storage and stopped near the limit; slot delete checks screens; music help text; music link never 500", () => {
    expect(readFileSync("src/lib/r2.ts", "utf8")).toContain("sum(schema.musicTracks.originalBytes)");
    expect(readFileSync("src/app/admin/(app)/phone/music/actions.ts", "utf8")).toContain("storageFull(");
    expect(readFileSync("src/app/admin/(app)/phone/prompts/slots/actions.ts", "utf8")).toContain("This slot is still used in");
    expect(readFileSync("src/app/admin/(app)/phone/music/page.tsx", "utf8")).toContain('"2 Phone Holding Music" plays when it is uploaded');
    expect(readFileSync("src/app/api/music/[...key]/route.ts", "utf8")).toContain("r2Get(key).catch(() => null)");
  });
});
