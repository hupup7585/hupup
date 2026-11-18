import { vi } from "vitest";
vi.mock("@/lib/db", async () => {
  const { createMemoryDb } = await import("./helpers/memory-db");
  const m = await createMemoryDb();
  return { db: m.db, schema: m.schema };
});
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { PROMPTS } from "@/lib/ivr/prompts";
import { blockers } from "@/lib/system-status";
import { htmlToText } from "@/lib/inbox-format";

/* Abraham, Nov 18, 2026: Music, Inbox, Catalog, Lines. */
describe("approved lines", () => {
  it("box 148 is the exact approved text, played only from the paid step; nothing at checkout says 'You are all set'", () => {
    expect(PROMPTS.phonepay_approved.text).toBe(
      "You are all set, {name}! Your payment was approved, and your booking is confirmed. Your order number is {number}. We will text your confirmation to the number you are calling from. To send it to a different number, press 1. Thank you for choosing Hup Up Attractions!",
    );
    const f = readFileSync("src/lib/ivr/flow.ts", "utf8");
    expect(f).not.toMatch(/"thanks_order"/);
    expect(f).not.toMatch(/ctx, "phonepay_paid"/);
    expect(f.match(/"phonepay_approved"/g)?.length).toBe(1);
  });
  it("star lines: 'To go back, press star.' wherever star goes back one menu", () => {
    expect(PROMPTS.back_to_menu.text).toBe("To go back, press star.");
    expect(PROMPTS.sold_out_options.text.endsWith("To go back, press star.")).toBe(true);
    expect(PROMPTS.sold_out_options_cart.text.endsWith("To go back, press star.")).toBe(true);
    const all = Object.values(PROMPTS).map((p) => p.text).join("\n");
    expect(all).not.toContain("For the main menu, press star.");
    expect(all).not.toContain("To go back to the main menu, press star.");
  });
});

describe("Text CATALOG reply status follows texting", () => {
  it("active when texting is on", async () => {
    const env = { TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_PHONE_NUMBER: "+18454157585", TWILIO_MESSAGING_SERVICE_SID: "MG1" };
    const row = (await blockers(env)).find((r) => r.key === "sms-catalog");
    expect(row?.active).toBe(true);
  });
});

describe("Inbox: HTML emails never show blank", () => {
  it("the text of an HTML email can always be shown", () => {
    expect(htmlToText("<html><head><style>p{color:red}</style></head><body><p>Hi&nbsp;there</p><div>Please send the <b>catalog</b>.</div></body></html>")).toBe("Hi there\nPlease send the catalog.");
    const page = readFileSync("src/app/admin/(app)/inbox/[id]/page.tsx", "utf8");
    expect(page).toContain("<EmailHtml");
    expect(page).not.toContain('sandbox=""');
  });
});
