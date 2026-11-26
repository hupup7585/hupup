import { describe, expect, it, vi } from "vitest";

/* Admin handoff Phase 3, section 6 (Nov 26, 2026): Test this screen shows exactly what a caller gets now, as a preview
 * call that saves nothing (no call session, no call journey, so nothing in the call log or dashboard). */
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
vi.mock("@/lib/ivr/prompts", async (orig) => ({ ...(await orig<typeof import("@/lib/ivr/prompts")>()), loadPromptOverrides: async () => ({}) }));

import { readFileSync } from "node:fs";
import { db, schema } from "@/lib/db";
import { describeTwiml, LIVE_PREVIEW_SCREENS, previewScreen } from "@/lib/ivr/screen-preview";

process.env.PUBLIC_BASE_URL = "https://hupup.example";

describe("Test this screen", () => {
  it("the main menu: its lines, the wait, and what happens with no key", async () => {
    const p = (await previewScreen("menu"))!;
    const text = p.steps.map((s) => s.text).join("\n");
    expect(text).toContain("For reservations and bookings, press 1.");
    expect(text).toContain("Half-second pause");
    expect(text).toMatch(/waits 3 seconds; a key goes to menu-choice/);
    expect(text).toMatch(/If no key: goes to /);
  });
  it("saves nothing: no call session, no call journey", async () => {
    for (const id of LIVE_PREVIEW_SCREENS) await previewScreen(id);
    expect(await db.select().from(schema.callSessions)).toHaveLength(0);
    expect(await db.select().from(schema.callEvents)).toHaveLength(0);
  });
  it("screens that depend on earlier steps are not run; they show their lines instead", async () => {
    expect(await previewScreen("pay-approved")).toBeNull();
    expect(readFileSync("src/app/admin/(app)/phone/screens/[id]/page.tsx", "utf8")).toContain("cannot be run on its own here");
  });
  it("reads the phone instructions in plain words", () => {
    const steps = describeTwiml('<Response><Gather timeout="5" numDigits="1" action="https://x/api/voice/cart-choice"><Say voice="v">Hi there</Say><Play>https://x/api/voice-audio/12.mp3?sig=1</Play></Gather><Redirect method="POST">https://x/api/voice/idle?to=cart</Redirect><Hangup/></Response>');
    expect(steps.map((s) => s.kind)).toEqual(["wait", "voice", "recording", "next", "hangup"]);
    expect(steps[0].text).toContain("waits 5 seconds; a key goes to cart-choice");
    expect(steps[3].text).toBe("If no key: goes to idle");
  });
});
