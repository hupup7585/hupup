import { afterAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

/* Music upload of Nov 18, 2026: R2 refused each piece with 411 (Length Required). R2, like this stand-in, refuses an upload
 * that does not say its size. A 5 MB MP3 goes up as 3 MB pieces, each with its size. */
let server: Server;
const got: { len: string | undefined; chunked: boolean; bytes: number }[] = [];

afterAll(() => server?.close());

describe("photo and music storage uploads say their size", () => {
  it("a 5 MB song (two pieces) is accepted by storage that requires the size", async () => {
    server = createServer((req, res) => {
      let n = 0;
      req.on("data", (c: Buffer) => (n += c.length));
      req.on("end", () => {
        got.push({ len: req.headers["content-length"], chunked: /chunked/i.test(String(req.headers["transfer-encoding"] ?? "")), bytes: n });
        res.statusCode = req.headers["content-length"] ? 200 : 411;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    process.env.CLOUDFLARE_R2_WORKERS_TOKEN = "test-token";
    process.env.CLOUDFLARE_ACCOUNT_ID = "acct";
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input instanceof Request ? input.url : input);
      if (u.includes("api.cloudflare.com")) return new Response(JSON.stringify({ result: { id: "tokid" } }));
      return real(`http://127.0.0.1:${port}${new URL(u).pathname}`, init);
    }) as typeof fetch;
    try {
      const { r2Put, _resetR2 } = await import("@/lib/r2");
      _resetR2();
      const song = new Uint8Array(5 * 1024 * 1024).map((_, i) => i % 251);
      const piece = 3 * 1024 * 1024;
      await r2Put("music/1/original/0", song.slice(0, piece), "application/octet-stream");
      await r2Put("music/1/original/1", song.slice(piece), "application/octet-stream");
    } finally {
      globalThis.fetch = real;
    }
    expect(got.map((g) => g.bytes)).toEqual([3 * 1024 * 1024, 2 * 1024 * 1024]);
    expect(got.every((g) => g.len && !g.chunked)).toBe(true);
  });
});
