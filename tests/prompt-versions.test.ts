import { describe, expect, it, vi } from "vitest";

/* Every phone line editable in Admin (Abraham, Nov 13, 2026). In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { readFileSync } from "node:fs";
import { PROMPTS, RETIRED_PROMPTS, loadPromptOverrides, promptArea, promptAudio, promptText, type PromptDef, type PromptKey } from "@/lib/ivr/prompts";
import { approveDraft, discardDraft, liveText, restoreVersion, saveDraft, validateWording, versionsFor } from "@/lib/prompt-versions";
import { lineStatus } from "@/lib/prompt-status";
import { staffAnnouncement } from "@/lib/ivr/routing";
import { storeGoogleRecording } from "@/lib/prompt-recordings";

describe("every line is on the page", () => {
  it("every line has an extension area (new lines appear automatically) and a status", async () => {
    const o = await loadPromptOverrides();
    for (const [k, d] of Object.entries(PROMPTS) as [PromptKey, PromptDef][]) {
      expect(promptArea(d.group), k).not.toBe("Other");
      expect(["Live", "Waiting for approval", "Not active yet", "Not used"]).toContain(lineStatus(k, o).status);
    }
    expect(lineStatus("main_hi", o).status).toBe("Live");
    expect(lineStatus("instr_balloons", o).status).toBe("Waiting for approval");
    expect(lineStatus("promo_ask", o).status).toBe("Not active yet");
    expect(lineStatus("spoken_readback", o).status).toBe("Not active yet");
    expect(lineStatus("voicemail_thanks", o).status).toBe("Not used");
    expect(RETIRED_PROMPTS.size).toBe(24);
  });
  it("the page reads the prompt list itself, and is Owner only", () => {
    const page = readFileSync("src/app/admin/(app)/phone/prompts/page.tsx", "utf8");
    expect(page).toContain("Object.entries(PROMPTS)");
    expect(page).toContain("await requireOwner()");
    const actions = readFileSync("src/app/admin/(app)/phone/prompts/actions.ts", "utf8");
    for (const fn of actions.match(/export async function \w+/g)!) expect(actions.slice(actions.indexOf(fn)).slice(0, 400), fn).toContain("requireOwner()");
  });
  it("the staff announcement and the texts and emails are lines too", () => {
    expect(staffAnnouncement("4", "Customer Service", null, { withNumber: PROMPTS.staff_whisper.text, noNumber: PROMPTS.staff_whisper_no_number.text })).toBe("Call from Hup Up Attractions, extension 3, Customer Service. Press 1 to accept, or press 2 to reject.");
    expect(staffAnnouncement("8", "Schools and Corporate Orders", null, { withNumber: "x", noNumber: "Call {name} now." })).toBe("Call Schools and Corporate Orders now.");
    for (const k of ["msg_catalog_text", "msg_catalog_email_subject", "msg_payment_link", "msg_receipt_body", "msg_payment_received"] as const) expect(PROMPTS[k].group).toBe("Texts and emails");
  });
});

describe("edit, approve, go back", () => {
  it("an edit is a draft; the live line keeps playing until it's approved", async () => {
    const before = await liveText("main_thanks");
    const d = await saveDraft("main_thanks", "Thank you for choosing Hup Up Attractions, have a great day.", 1);
    expect(d.status).toBe("draft");
    expect(await liveText("main_thanks")).toBe(before);
    expect(promptText(await loadPromptOverrides(), "main_thanks")).toBe(before);
    await approveDraft(d.id, 1);
    expect(await liveText("main_thanks")).toBe("Thank you for choosing Hup Up Attractions, have a great day.");
    const v = await versionsFor("main_thanks");
    expect(v.map((x) => x.status)).toEqual(["live", "replaced"]);
    expect(v[1].text).toBe(PROMPTS.main_thanks.text); // the original wording is kept
    expect(v[1].note).toBe("Original wording");
  });
  it("go back to an older version: it's live again, and the history keeps everything", async () => {
    const [, original] = await versionsFor("main_thanks");
    await restoreVersion(original.id, 1);
    expect(await liveText("main_thanks")).toBe(PROMPTS.main_thanks.text);
    expect((await versionsFor("main_thanks")).map((x) => x.status)).toEqual(["live", "replaced", "replaced"]);
  });
  it("a draft can be set aside (kept); changing parts must stay; spoken lines are one paragraph; texts can have new lines", async () => {
    const d = await saveDraft("main_9", "For feedback, press 9.", 1);
    await discardDraft(d.id, 1);
    expect((await versionsFor("main_9"))[0].status).toBe("discarded");
    expect(() => validateWording("catalog_final", "Your email is ready.")).toThrow("{email}");
    expect(() => validateWording("main_9", "line one\nline two")).toThrow("one paragraph");
    expect(validateWording("msg_catalog_email_top", "Hi!\n\nHere it is:")).toBe("Hi!\n\nHere it is:");
  });
  it("approving a line waiting for approval (a Key 2 script) makes it play", async () => {
    const d = await saveDraft("instr_balloons", "Here's how to enjoy your jumping balloon safely. Keep shoes off.", 1);
    await approveDraft(d.id, 1);
    expect(lineStatus("instr_balloons", await loadPromptOverrides()).status).not.toBe("Waiting for approval");
  });
  it("the Google recording of the live wording plays; an edit falls back to the live voice until it's recorded again", async () => {
    const rec = await storeGoogleRecording("main_star_again", "main_star_again-google.mp3", PROMPTS.main_star_again.text, Buffer.from("ID3x"), 1);
    expect(promptAudio(await loadPromptOverrides(), "main_star_again")).toContain(`/prompt/${rec.id}?`);
    const d = await saveDraft("main_star_again", "To hear this menu again, press star.", 1);
    await approveDraft(d.id, 1);
    expect(promptAudio(await loadPromptOverrides(), "main_star_again")).toBeNull();
  });
});
