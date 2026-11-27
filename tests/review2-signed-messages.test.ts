import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { msgQuery, trustedMsg } from "@/lib/url-message";

/* Hark's review L11 (Nov 26, 2026): message text in a page address is shown only when our own Save wrote it. */
describe("signed page messages", () => {
  it("a message written by a Save shows; a typed one does not", () => {
    const q = new URLSearchParams(msgQuery("Saved."));
    expect(trustedMsg(q.get("m"), q.get("ms"))).toBe("Saved.");
    expect(trustedMsg("Published", null)).toBeNull();
    expect(trustedMsg("Published", q.get("ms"))).toBeNull();
    expect(trustedMsg("Published", "x")).toBeNull();
  });
  it("custom names keep their own signature (ok, err)", () => {
    const q = new URLSearchParams(msgQuery("Not saved: no.", "err"));
    expect(trustedMsg(q.get("err"), q.get("errs"))).toBe("Not saved: no.");
  });
  const B = "src/app/admin/(app)/";
  it("the Owner pages read only signed messages, and their Saves sign them", () => {
    for (const f of ["offers", "units", "delivery-settings", "discounts", "phone/phonepay", "config"]) {
      expect(readFileSync(`${B}${f}/page.tsx`, "utf8"), f).toContain("trustedMsg(");
    }
    for (const f of ["offers/actions.ts", "units/actions.ts", "delivery-settings/area-actions.ts", "discounts/actions.ts", "phone/phonepay/actions.ts", "config/actions.ts"]) {
      const s = readFileSync(`${B}${f}`, "utf8");
      expect(s, f).toContain("msgQuery(");
      expect(s, f).not.toMatch(/[?&](m|ok|err)=\$\{encodeURIComponent/);
    }
  });
});
