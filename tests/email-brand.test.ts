import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EMAIL_SIGNATURE_DEFAULT, brandedEmail } from "@/lib/email-brand";

/* Logo and signature on every email (Abraham, Nov 17, 2026). */
describe("branded email", () => {
  it("the signature, word for word", () => {
    // Abraham, Nov 18, 2026: no "Thanks!", the tagline under the name
    expect(EMAIL_SIGNATURE_DEFAULT).toBe("Hup Up Attractions\nBringing Something Special To Every Occasion\nJumping Balloons | Laser Tag | Inflatable Mazes | Paddle Boats\n(845) 777-7585 | info@hupupattractions.com | hupupattractions.com\nKiryas Joel and Orange County, NY.");
  });
  it("HTML: hosted logo (no attachment) with Hup Up Attractions Inc., the message, then the signature with links; plain text too", () => {
    const e = brandedEmail("Hi Sara,\n\nThank you for your booking! <b>no tags</b>", { baseUrl: "https://hupupattractions.com" });
    expect(e.html).toContain(`src="https://hupupattractions.com/brand/hupup-logo-320.png"`);
    expect(e.html).toContain("Hup Up Attractions Inc.");
    expect(e.html).toContain("&lt;b&gt;no tags&lt;/b&gt;");
    expect(e.html).toContain('href="tel:+18457777585"');
    expect(e.html).toContain('href="mailto:info@hupupattractions.com"');
    expect(e.html).toContain('href="https://hupupattractions.com"');
    expect(e.html.indexOf("Thank you for your booking")).toBeLessThan(e.html.indexOf("Bringing Something Special To Every Occasion"));
    expect(e.html).toContain('font-style:italic;line-height:1.5;color:#777777;margin-bottom:4px">Bringing Something Special To Every Occasion</div>');
    expect(e.html).not.toContain("Thanks!");
    expect(e.text).toBe(`Hi Sara,\n\nThank you for your booking! <b>no tags</b>\n\n--\n${EMAIL_SIGNATURE_DEFAULT}\n`);
  });
  it("the Owner's own signature from Admin replaces the default", () => {
    expect(brandedEmail("Hello", { baseUrl: "https://x.com", signature: "Thanks,\nAbraham" }).text).toBe("Hello\n\n--\nThanks,\nAbraham\n");
  });
  it("every email goes through it, and the Owner edits the signature in Admin", () => {
    expect(readFileSync("src/lib/notify.ts", "utf8")).toContain("html: branded.html");
    expect(readFileSync("src/app/admin/(app)/settings/page.tsx", "utf8")).toContain("<EmailSignatureForm");
    expect(readFileSync("src/app/admin/(app)/settings/email-actions.ts", "utf8")).toContain("await requireOwner()");
  });
});

describe("email items 7, 10 and 13 (Abraham, Nov 17, 2026)", () => {
  it("fits a phone: the logo and name stack, the text gets room", () => {
    const e = brandedEmail("Hi", { baseUrl: "https://x.com" });
    expect(e.html).toContain('<meta name="viewport"');
    expect(e.html).toContain("@media only screen and (max-width:600px)");
    expect(e.html).toContain('class="hu-name"');
  });
  it("every sent email is kept under Sent with its files; the Admin inbox's own sends are not saved twice", () => {
    const notify = readFileSync("src/lib/notify.ts", "utf8");
    expect(notify).toContain("recordSentEmail");
    const inbox = readFileSync("src/lib/inbox.ts", "utf8");
    expect(inbox.match(/record: false/g)).toHaveLength(2);
    expect(inbox).not.toContain("${REPLY_SIGNATURE}"); // the branded signature replaces the old one-line signature
  });
  it("catalog email: the PDF attached while the switch is on, and the catalog's name in the subject", () => {
    const s = readFileSync("src/lib/catalog-send.ts", "utf8");
    expect(s).toContain('s.catalogAutoAttach !== false ? await catalogPdfAttachment()');
    expect(s).toContain("const t = catalogEmailTemplate(s);");
    expect(s).toContain(`sendEmail(to, t.subject, t.body, [pdf], { noThanks: true, kind: "catalog" })`);
    expect(readFileSync("src/app/admin/(app)/catalog-send/page.tsx", "utf8")).toContain("<CatalogEmailForm");
  });
});

describe("the approved catalog email (Abraham, Nov 17, 2026)", () => {
  it("subject and text, word for word", async () => {
    const { catalogEmailBody, catalogEmailSubject } = await import("@/lib/catalog-send");
    expect(catalogEmailSubject("Chanukah Catalog 2026")).toBe("Chanukah Catalog 2026 - Hup Up Attractions");
    expect(catalogEmailBody("Chanukah Catalog 2026")).toBe("Dear valued customer,\n\nFind our Chanukah Catalog 2026 attached. You can call us anytime to book with our automated system at (845) 777-7585 Ext. 1.\n\nThank you for choosing Hup Up Attractions!");
  });
});

describe("promotional emails only: mailing address and Unsubscribe (Abraham, Nov 17, 2026)", () => {
  it("promo: the address (blank until given) and an Unsubscribe link; booking emails have neither", async () => {
    const promo = brandedEmail("Sale!", { baseUrl: "https://x.com", promo: { address: "", unsubscribeUrl: "https://x.com/unsubscribe?e=a%40b.com&s=1" } });
    expect(promo.html).toContain(">Unsubscribe</a>");
    expect(promo.text).toContain("Unsubscribe: https://x.com/unsubscribe?e=a%40b.com&s=1");
    const booking = brandedEmail("Your booking", { baseUrl: "https://x.com" });
    expect(booking.html).not.toContain("Unsubscribe");
    const withAddress = brandedEmail("Sale!", { baseUrl: "https://x.com", promo: { address: "1 Main Street, Monroe, NY 10950", unsubscribeUrl: "https://x.com/u" } });
    expect(withAddress.text).toContain("1 Main Street, Monroe, NY 10950\nUnsubscribe: https://x.com/u");
  });
  it("the unsubscribe link is signed per address", async () => {
    process.env.AUTH_SECRET = "test-secret-unsub-0123456789";
    const { unsubscribeLink, verifyUnsubscribe } = await import("@/lib/signed-link");
    const link = new URL(unsubscribeLink("Sara@Example.com", "https://x.com"));
    expect(verifyUnsubscribe(link.searchParams.get("e"), link.searchParams.get("s"))).toBe(true);
    expect(verifyUnsubscribe("other@example.com", link.searchParams.get("s"))).toBe(false);
  });
});

describe("catalog email wording edited by the Owner (Abraham, Nov 17, 2026)", () => {
  it("blank = the approved wording; edited wording is used, with {Catalog Name} filled in", async () => {
    const { catalogEmailTemplate, catalogEmailBody, catalogEmailSubject } = await import("@/lib/catalog-send");
    expect(catalogEmailTemplate({ catalogName: "Purim Catalog" })).toEqual({ subject: catalogEmailSubject("Purim Catalog"), body: catalogEmailBody("Purim Catalog") });
    expect(catalogEmailTemplate({})).toEqual({ subject: catalogEmailSubject("catalog"), body: catalogEmailBody("catalog") });
    expect(catalogEmailTemplate({ catalogName: "Purim Catalog", catalogEmailSubjectText: "Our {Catalog Name}", catalogEmailBodyText: "Hello,\r\n\r\nHere is the {Catalog Name}." })).toEqual({
      subject: "Our Purim Catalog",
      body: "Hello,\n\nHere is the Purim Catalog.",
    });
  });
  it("the Owner edits subject and message on Catalog email & text, with a way back to the approved wording", () => {
    const form = readFileSync("src/app/admin/(app)/catalog-send/CatalogEmailForm.tsx", "utf8");
    expect(form).toContain('name="subject"');
    expect(form).toContain('name="body"');
    expect(form).toContain("data-catalog-email-reset");
    const a = readFileSync("src/app/admin/(app)/catalog-send/actions.ts", "utf8");
    expect(a).toContain('saveSetting("catalogEmailSubjectText", subject, owner.userId)');
    expect(a).toContain('saveSetting("catalogEmailBodyText", body, owner.userId)');
  });
  it("Compose has Add our catalog (new emails only), sending the PDF from the server", () => {
    const f = readFileSync("src/app/admin/(app)/inbox/[id]/ReplyForm.tsx", "utf8");
    expect(f).toContain("data-add-catalog");
    expect(f).toContain("sendNewEmailAction(to, subject, body, ids, draftId ?? null, props.forwardOf ?? null, withCatalog, html)");
    expect(readFileSync("src/app/admin/(app)/inbox/new/page.tsx", "utf8")).toContain("catalogEmailTemplate(await getSettings())");
  });
});

describe("no Thanks! on any email (Abraham, Nov 18, 2026; catalog emails first on Nov 17)", () => {
  it("the signature starts with Hup Up Attractions everywhere, also when an older saved signature began with Thanks!", async () => {
    const { brandedEmail, EMAIL_SIGNATURE_DEFAULT } = await import("@/lib/email-brand");
    expect(EMAIL_SIGNATURE_DEFAULT.startsWith("Hup Up Attractions\n")).toBe(true);
    for (const e of [brandedEmail("Body", { baseUrl: "https://x", noThanks: true }), brandedEmail("Body", { baseUrl: "https://x" })]) {
      expect(e.text).toBe(`Body\n\n--\n${EMAIL_SIGNATURE_DEFAULT}\n`);
      expect(e.html).not.toContain("Thanks!");
    }
    expect(brandedEmail("Body", { baseUrl: "https://x", signature: "Thanks!\n\nHup Up Attractions" }).text).toBe("Body\n\n--\nHup Up Attractions\n");
  });
});
