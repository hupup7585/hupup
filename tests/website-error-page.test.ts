import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/*
 * Website error page (Abraham, Nov 27, 2026, item 7; replaces the W1 draft): on any website or database problem, the
 * branded page with his exact words, the site header with the logo and the footer, a white card, the phone number as
 * a tap-to-call link, one button "Back to homepage", no error codes or technical words. Live (approved).
 */
vi.mock("@/app/fonts", () => ({ inter: { variable: "font-inter" }, poppins: { variable: "font-poppins" } }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("database is down"); } }), schema: {} }));

import { ERROR_PAGE_BUTTON, ERROR_PAGE_TEXT } from "@/lib/error-page-copy";
import ErrorPage from "@/app/error";
import GlobalError from "@/app/global-error";
import NotFound from "@/app/not-found";

const EXACT = "We apologize, this page is temporarily unavailable. Please try again in a few minutes. For immediate assistance, please call us at (845) 777-7585.";
const visible = (html: string) => html.replace(/<\/(h1|p|div|section|li|nav|header)>/g, " ").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const forcedServerError = Object.assign(new Error('relation "orders" does not exist at db.query (pg)'), { digest: "1234567890" });

describe("website error page", () => {
  it("a forced server error shows this page with the exact text (no codes, no technical words)", () => {
    const html = renderToStaticMarkup(createElement(ErrorPage as never, { error: forcedServerError, reset: () => {} }));
    expect(ERROR_PAGE_TEXT).toBe(EXACT);
    expect(visible(html)).toContain(EXACT);
    for (const bad of ["1234567890", "relation", "pg", "digest", "Error", "500", "Something went wrong", "Application error"]) expect(visible(html)).not.toContain(bad);
  });

  it("full site header with the logo, the footer, a white card, tap-to-call phone, one button 'Back to homepage'; one H1", () => {
    const html = renderToStaticMarkup(createElement(ErrorPage as never, { error: forcedServerError, reset: () => {} }));
    expect(html).toContain("<header");
    expect(html).toMatch(/<img[^>]*alt="Hup Up Attractions"/);
    expect(html).toContain("<footer");
    expect(html).toMatch(/data-error-card[^>]*>|class="[^"]*bg-white[^"]*"[^>]*data-error-card/);
    expect(html).toMatch(/<a href="tel:\+18457777585"[^>]*data-error-phone[^>]*>\(845\) 777-7585<\/a>/);
    expect(ERROR_PAGE_BUTTON).toBe("Back to homepage");
    expect(html.match(/data-error-home/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="\/"[^>]*data-error-home[^>]*>Back to homepage<\/a>/);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain("<button"); // one button only (no Try again)
  });

  it("global-error (the main layout itself failed) and the not-found page show the same page; no database needed", () => {
    const g = renderToStaticMarkup(createElement(GlobalError as never, { error: forcedServerError, reset: () => {} }));
    expect(g).toMatch(/^<html lang="en"/);
    expect(visible(g)).toContain(EXACT);
    const nf = renderToStaticMarkup(createElement(NotFound));
    expect(visible(nf)).toContain(EXACT);
  });

  it("live on every site (no preview-only switch); details logged on the server only", () => {
    const src = readFileSync("src/app/error.tsx", "utf8");
    expect(src).not.toContain("throw error");
    expect(src).not.toMatch(/error\.(message|digest|stack)/);
    expect(readFileSync("src/app/global-error.tsx", "utf8")).not.toMatch(/error\.(message|digest|stack)/);
  });
});
