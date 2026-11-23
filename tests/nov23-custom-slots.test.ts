import { describe, expect, it, vi } from "vitest";

/* Add a new slot in Admin (Abraham, Nov 23, 2026), and the read-back part by part from the recordings that are live. */
const h = vi.hoisted(() => ({
  session: { callSid: "CAslots", fromNumber: "+18455550133", orderId: null as number | null, data: {} as Record<string, unknown>, status: "in_progress", outcome: "browsing" },
}));
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/session", () => ({
  ensureSession: async () => h.session,
  getSession: async () => h.session,
  updateSession: async (_s: string, patch: Record<string, unknown> & { data?: Record<string, unknown> }) => Object.assign(h.session, { ...patch, data: { ...h.session.data, ...(patch.data ?? {}) } }),
}));

import { db, schema } from "@/lib/db";
import { handleVoice } from "@/lib/ivr/flow";

const call = (action: string) => handleVoice({ action, query: new URLSearchParams(), body: { CallSid: "CAslots" }, callSid: "CAslots", from: "+18455550133" });

/** A live recording for a slot key (what Use this one does). */
async function live(key: string) {
  const [r] = await db.insert(schema.promptRecordings).values({ promptKey: key, source: "upload", fileName: `${key}.mp3`, contentType: "audio/mpeg", sizeBytes: 10, complete: true } as never).returning();
  await db.insert(schema.voicePrompts).values({ key, recordingId: r.id }).onConflictDoUpdate({ target: schema.voicePrompts.key, set: { recordingId: r.id } });
  return r.id;
}

describe("Add a new slot", () => {
  it("lookup keys by group; a duplicate key warns and is not saved; rename; delete", async () => {
    const { slotKeyFor, addCustomSlot, addCustomSlots, customSlots, renameCustomSlot, deleteCustomSlot } = await import("@/lib/custom-slots");
    expect(slotKeyFor("Streets", "D A Weider Boulevard")).toBe("street:d_a_weider_boulevard");
    expect(slotKeyFor("Zip codes", "10930")).toBe("zip:10930");
    expect(slotKeyFor("Unit numbers", "S02")).toBe("unit:S02");
    expect(slotKeyFor("Number words", "25")).toBe("word:twenty five");
    expect(slotKeyFor("Zip codes", "109")).toBeNull();
    const r = await addCustomSlot({ name: "Street - D A Weider Boulevard", group: "Streets", text: "D A Weider Boulevard", lookup: "D A Weider Boulevard", plays: "address read-back" }, [], null);
    expect(r).toEqual({ ok: true, key: "street:d_a_weider_boulevard" });
    const existing = (await customSlots()).map((s) => ({ key: s.key, group: s.group }));
    expect(await addCustomSlot({ name: "Again", group: "Streets", text: "D A Weider Boulevard", lookup: "d a weider boulevard" }, existing, null)).toEqual({ ok: false, message: "That lookup key is already used in Streets." });
    expect((await addCustomSlot({ name: "No", group: "Other", text: "You're here.", lookup: "x" }, existing, null)).ok).toBe(false); // no contractions
    const bulk = await addCustomSlots([{ name: "Unit - three zero one", group: "Unit numbers", text: "three zero one", lookup: "301" }, { name: "Bad zip", group: "Zip codes", text: "one", lookup: "1" }], existing, null);
    expect(bulk.added).toBe(1);
    expect(bulk.problems[0].line).toBe(3);
    expect((await renameCustomSlot("unit:301", "Unit 301", null)).ok).toBe(true);
    expect((await customSlots()).find((s) => s.key === "unit:301")?.label).toBe("Unit 301");
    const { allSlots } = await import("@/lib/recording-slots");
    expect(allSlots([], {}, await customSlots()).some((s) => s.key === "street:d_a_weider_boulevard")).toBe(true);
    await addCustomSlot({ name: "Temp", group: "Other", text: "Temp line.", lookup: "temp" }, [], null);
    expect((await deleteCustomSlot("custom:temp", null)).ok).toBe(true);
    expect((await deleteCustomSlot("zip:10950", null)).ok).toBe(false); // only slots added in Admin
    const { readFileSync } = await import("node:fs");
    const actions = readFileSync("src/app/admin/(app)/phone/prompts/slots/actions.ts", "utf8");
    expect(actions).toContain('if (s.role !== "owner") return { ok: false, message: "Only the Owner can delete a slot." };');
    expect(readFileSync("src/app/admin/(app)/phone/prompts/slots/SlotRow.tsx", "utf8")).toContain("Are you sure you want to delete the slot");
  });

  it("read-back for 10 D A Weider Boulevard, unit 301, Monroe New York, 10950: live recordings where there are some, Puck for the rest", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    const street = await live("street:d_a_wieder_boulevard"); // street 072: Weider and Wieder are the same slot
    const unit = await live("unit:301");
    const zip = await live("zip:10950");
    h.session.data = { address: "10 D A Weider Boulevard, 301, Monroe, NY 10950", house: "10", street: "D A Weider Boulevard", unit: "301", zip: "10950", town: "Monroe" };
    const xml = await call("addr-readback");
    const order = [...xml.matchAll(/<(Play|Say)[^>]*>([^<]+)<\/\1>/g)].map((m) => (m[1] === "Play" ? `play ${m[2].match(/prompt\/(\d+)/)?.[1] ?? m[2]}` : `say ${m[2]}`));
    const i = order.indexOf("say Here is the address you entered.");
    expect(order.slice(i + 1, i + 7)).toEqual(["say ten", `play ${street}`, "say unit", `play ${unit}`, "say Monroe New York", `play ${zip}`]);
  });
});
