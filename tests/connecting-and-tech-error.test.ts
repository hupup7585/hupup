import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

/* Abraham, Nov 27, 2026, 1:20 AM: customer service transfers (main menu key 3, bookings key 0 = line 4) hear their own
   connecting line; every other transfer keeps "our team"; tech_error is followed by the before-payment goodbye. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { PROMPTS } from "@/lib/ivr/prompts";
import { handleVoice } from "@/lib/ivr/flow";

describe("connecting lines", () => {
  it("the new slot and its words; customer service only", () => {
    expect(PROMPTS.transfer_connecting_cs).toMatchObject({ label: "Connecting to customer service", text: "One moment, please. We are connecting you to our customer service." });
    expect(PROMPTS.transfer_connecting.text).toBe("One moment, please. We are connecting you to our team.");
    const flow = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(flow).toContain('sp(vr, ctx, k === "4" ? "transfer_connecting_cs" : "transfer_connecting");');
    expect(flow).toMatch(/case "3": \/\/ customer service[^\n]*\n\s*return back\(vr, "ring", \{ k: "4" \}\);/);
    expect(flow).toContain('back(vr, "ring", { k: "4" }) : back(vr, "cs-closed")'); // bookings key 0
  });
});

describe("tech error", () => {
  it("the goodbye plays after tech_error, then the call ends", async () => {
    process.env.PUBLIC_BASE_URL = "https://hupup.example";
    // a broken session read forces the error path
    const xml = await handleVoice({ action: "book", query: new URLSearchParams(), body: { CallSid: "CAerr" }, callSid: null as unknown as string, from: "+18455550123" });
    expect(xml).toContain("Oops, something went wrong on our end.");
    expect(xml.indexOf("Thank you for calling Hup Up Attractions")).toBeGreaterThan(xml.indexOf("Oops"));
    expect(xml).toContain("<Hangup/>");
  });
});
