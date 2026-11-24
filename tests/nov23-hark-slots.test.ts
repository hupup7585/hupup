import { describe, expect, it, vi } from "vitest";

/* Hark, Nov 23, 2026, 11:38 PM: Abraham's newest approved hotline lines and Admin recording slots. In-memory database. */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});

import { PROMPTS } from "@/lib/ivr/prompts";
import { slotsWithStatus } from "@/lib/slot-status";

describe("1. ask_name (Checkout)", () => {
  it("the new approved text, word for word; the slot is Waiting until the text is confirmed for the new recording", async () => {
    expect(PROMPTS.ask_name.text).toBe("Thank you. Let us complete your booking. Please say your first and last name after the tone.");
    expect(PROMPTS.ask_name.group).toBe("Checkout");
    const slot = (await slotsWithStatus()).find((s) => s.key === "ask_name");
    expect(slot).toMatchObject({ text: PROMPTS.ask_name.text, status: "waiting" });
  });
});
