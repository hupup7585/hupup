import { afterEach, describe, expect, it, vi } from "vitest";

/* Deep check C7 (Nov 27, 2026): the info@ Cloudflare Worker never drops the Admin inbox copy silently. */
// @ts-expect-error plain JavaScript Worker, no types
import worker from "../cloudflare/info-inbox-worker.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const run = async (forward: () => Promise<void>, answer: (url: string) => Response) => {
  const urls: string[] = [];
  globalThis.fetch = (async (u: string) => (urls.push(String(u)), answer(String(u)))) as typeof fetch;
  const waits: Promise<unknown>[] = [];
  const message = { forward, raw: new Blob([new Uint8Array(10)]).stream() };
  let thrown: unknown = null;
  await worker.email(message, { SITE_URL: "https://site", INBOUND_EMAIL_SECRET: "s" }, { waitUntil: (p: Promise<unknown>) => waits.push(p) }).catch((e: unknown) => (thrown = e));
  await Promise.all(waits);
  return { urls, thrown };
};

describe("deep check C7: info@ Worker", () => {
  it("a Gmail forward error still sends the Admin inbox copy, then reports the error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await run(async () => Promise.reject(new Error("gmail refused")), () => new Response("{}"));
    expect(r.urls).toHaveLength(1);
    expect(String(r.thrown)).toContain("gmail refused");
  });
  it("a refused piece is not tried again and the stop is logged", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await run(async () => undefined, () => new Response("bad piece", { status: 400 }));
    expect(r.urls).toHaveLength(1);
    expect(r.thrown).toBeNull();
    expect(String(err.mock.calls.at(-1)?.[0])).toContain("upload stopped at piece 1 of 1");
  });
  it("a network error is tried three times", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const urls: string[] = [];
    const r = await run(async () => undefined, (u) => {
      urls.push(u);
      throw new Error("network");
    });
    expect(urls).toHaveLength(3);
    expect(r.thrown).toBeNull();
  });
});
