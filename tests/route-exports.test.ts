import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/* Next.js only allows its own export names in route files; anything else fails the Vercel build (it happened on
 * Nov 26, 2026 with a helper exported from /api/cron/frequent). This test catches it before a push. */
const ALLOWED = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "dynamic", "revalidate", "runtime", "maxDuration", "fetchCache", "preferredRegion", "dynamicParams", "generateStaticParams"]);
const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f === "route.ts" ? [join(d, f)] : []));

describe("route files export only what Next.js allows", () => {
  it.each(files("src/app"))("%s", (f) => {
    const names = [...readFileSync(f, "utf8").matchAll(/^export (?:async )?(?:const|function|let) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
    expect(names.filter((n) => !ALLOWED.has(n)), f).toEqual([]);
  });
});
