import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { audioType, checkOutgoingFiles, fileKind, serveHeaders } from "@/lib/message-files";

/* Voice notes by text (Abraham, Nov 19, 2026): send MP3 and WAV from Admin, and receive them. */
const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20]);
const id3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const frame = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

describe("voice notes", () => {
  it("MP3 (with or without a tag) and WAV are recognized from their first bytes", () => {
    expect(fileKind(wav)).toBe("audio/wav");
    expect(fileKind(id3)).toBe("audio/mpeg");
    expect(fileKind(frame)).toBe("audio/mpeg");
  });
  it("staff can attach them to a text (5 MB in all, as for photos)", () => {
    const r = checkOutgoingFiles([{ name: "note.mp3", data: id3 }, { name: "note.wav", data: wav }]);
    expect(r).toEqual({ ok: true, kinds: ["audio/mpeg", "audio/wav"] });
    expect(checkOutgoingFiles([{ name: "x.exe", data: new Uint8Array([0x4d, 0x5a, 0, 0]) }])).toMatchObject({ ok: false });
  });
  it("they are served with their own kind (so phones and Admin can play them), and phone kinds are named the usual way", () => {
    expect(serveHeaders({ contentType: "audio/mpeg", fileName: null, id: 4 })["Content-Type"]).toBe("audio/mpeg");
    expect(serveHeaders({ contentType: "audio/wav", fileName: null, id: 5 })["Content-Disposition"]).toBe('inline; filename="file-5.wav"');
    expect(audioType("audio/x-wav")).toBe("audio/wav");
    expect(audioType("audio/x-m4a")).toBe("audio/mp4");
  });
  it("Admin plays voice notes in the conversation and lets staff attach MP3 and WAV", () => {
    expect(readFileSync("src/components/staff/MessageFiles.tsx", "utf8")).toContain("<audio controls");
    expect(readFileSync("src/app/admin/(app)/messages/ReplyForm.tsx", "utf8")).toContain("audio/mpeg,audio/wav,.mp3,.wav");
  });
});
