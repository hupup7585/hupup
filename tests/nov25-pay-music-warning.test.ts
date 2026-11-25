import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/* Batch 2 item 8 (Abraham, Nov 25, 2026): a clear warning when no song is chosen for the payment line. */
const h = vi.hoisted(() => ({ tracks: [] as { id: number; pieces: number; pieceSeconds: number }[] }));
vi.mock("@/lib/music", () => ({ placeTracks: async (place: string) => (place === "pay" ? h.tracks : []) }));

import PayMusicWarning from "@/components/PayMusicWarning";

describe("payment line music warning", () => {
  it("shows when no song is chosen, with a link to Music", async () => {
    h.tracks = [];
    const html = renderToStaticMarkup((await PayMusicWarning())!);
    expect(html).toContain("No song is chosen for the payment line.");
    expect(html).toContain('href="/admin/phone/music"');
  });
  it("hidden once a song is chosen", async () => {
    h.tracks = [{ id: 1, pieces: 10, pieceSeconds: 8 }];
    expect(await PayMusicWarning()).toBeNull();
  });
  it("is on the payment line page and the Music page", async () => {
    const fs = await import("node:fs");
    expect(fs.readFileSync("src/app/admin/(app)/phone/phonepay/page.tsx", "utf8")).toContain("<PayMusicWarning />");
    expect(fs.readFileSync("src/app/admin/(app)/phone/music/page.tsx", "utf8")).toContain("<PayMusicWarning />");
  });
});
