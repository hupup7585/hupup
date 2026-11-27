// Website baseline (Admin handoff, website part, Phase W1): what every public page shows today.
// Usage: build, start the site (npx next start -p 3999), then:
//   node scripts/website-baseline.mjs http://localhost:3999            -> writes docs/handoff/website-baseline.json
//   node scripts/website-baseline.mjs http://localhost:3999 --check    -> fails if any page differs from that file
// Saved per page: status, <title>, meta description, robots, canonical, the H1s, the JSON-LD and the visible text.
import { readFileSync, writeFileSync } from "node:fs";

const base = (process.argv[2] || "http://localhost:3999").replace(/\/$/, "");
const check = process.argv.includes("--check");
const PAGES = ["/", "/privacy", "/terms", "/sms-terms", "/text-alerts", "/unsubscribe", "/paid", "/paid?xResult=D", "/this-page-does-not-exist"];
const FILE = "docs/handoff/website-baseline.json";

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;| /g, " ");
const attr = (html, re) => decode((html.match(re) || [])[1] || "");
function visibleText(html) {
  const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/) || [])[1] || "";
  return decode(
    body
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<style[\s\S]*?<\/style>/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/© \d{4}/, "© YEAR"); // the footer year changes by itself
}

const out = {};
for (const p of PAGES) {
  const r = await fetch(base + p, { redirect: "manual" });
  const html = await r.text();
  out[p] = {
    status: r.status,
    title: attr(html, /<title>([^<]*)<\/title>/),
    description: attr(html, /<meta name="description" content="([^"]*)"/),
    robots: attr(html, /<meta name="robots" content="([^"]*)"/),
    canonical: attr(html, /<link rel="canonical" href="([^"]*)"/).replace(/^https?:\/\/[^/]+/, ""),
    h1: [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, "")).trim()),
    jsonLd: [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1])).map((j) => ({ ...j, url: undefined })),
    text: visibleText(html),
  };
}
if (check) {
  const saved = JSON.parse(readFileSync(FILE, "utf8"));
  let bad = 0;
  for (const p of PAGES) {
    for (const k of Object.keys(out[p])) {
      if (JSON.stringify(out[p][k]) !== JSON.stringify(saved[p]?.[k])) {
        bad++;
        console.error(`DIFFERENT ${p} ${k}`);
      }
    }
  }
  if (bad) process.exit(1);
  console.log(`website baseline: ${PAGES.length} pages unchanged`);
} else {
  writeFileSync(FILE, JSON.stringify(out, null, 1) + "\n");
  console.log(`wrote ${FILE} (${PAGES.length} pages)`);
}
