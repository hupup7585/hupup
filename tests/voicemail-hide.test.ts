import { describe, expect, it, vi } from "vitest";

/* Voicemail Delete (Abraham, Nov 13, 2026): hide and keep the recording; only the Owner deletes for good. */

const h = vi.hoisted(() => ({ removed: [] as string[] }));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/twilio-client", () => ({ getTwilio: () => ({ recordings: (sid: string) => ({ remove: async () => h.removed.push(sid) }) }) }));

import { db, schema } from "@/lib/db";
import { deleteVoicemail, hiddenVoicemails, listVoicemails, mainBox, purgeVoicemail, restoreVoicemail } from "@/lib/voicemail";

describe("voicemail delete", () => {
  it("Delete hides the message and keeps the recording; the Owner can show it again or delete it for good", async () => {
    const box = await mainBox();
    const [v] = await db.insert(schema.voicemails).values({ boxId: box.id, recordingSid: "RE900", recordingUrl: "https://api.twilio.com/x/RE900", durationSec: 5, state: "submitted" }).returning();
    expect((await listVoicemails()).map((x) => x.id)).toContain(v.id);

    await deleteVoicemail(v.id);
    expect((await listVoicemails()).map((x) => x.id)).not.toContain(v.id);
    expect((await hiddenVoicemails()).map((x) => x.id)).toContain(v.id);
    expect(h.removed).toEqual([]); // recording kept

    await restoreVoicemail(v.id);
    expect((await listVoicemails()).map((x) => x.id)).toContain(v.id);

    await deleteVoicemail(v.id);
    expect(await purgeVoicemail(v.id)).toBe(true);
    expect(h.removed).toEqual(["RE900"]);
    expect((await hiddenVoicemails()).map((x) => x.id)).not.toContain(v.id);
    expect(await restoreVoicemail(v.id)).toBe(false); // gone for good
  });
  it("only the Owner can show again or delete for good", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/app/admin/(app)/voicemail/actions.ts", "utf8");
    for (const fn of ["restoreVoicemailAction", "purgeVoicemailAction"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`)).split("\n}\n")[0];
      expect(body).toContain("requireOwner()");
    }
  });
});
