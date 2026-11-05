// E2E: customer on the website (in-memory DB). Usage: node scripts/e2e/customer-web.cjs
const { chromium } = require("playwright");
const q = require("./q.cjs");
const BASE = process.env.E2E_BASE || "http://localhost:3100";
const results = [];
const PHONE4 = String(1000 + Math.floor(Math.random() * 8999));
const E164 = `+1845555${PHONE4}`;
const check = (name, ok, info = "") => (results.push({ name, ok }), console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`));

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 900 } });
  for (const path of ["/", "/terms", "/sms-terms", "/privacy", "/text-alerts"]) {
    const r = await p.goto(BASE + path);
    const over = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    check(`page ${path} loads (390px, no sideways scroll)`, r.status() === 200 && !over, `status ${r.status()}`);
  }
  const red = await p.goto(BASE + "/privacy-policy");
  check("/privacy-policy redirects to /privacy", p.url().endsWith("/privacy") && red.status() === 200);
  await p.goto(BASE + "/");
  const html = await p.content();
  check("home: no cart, checkout, or login for customers", !/add to cart|checkout|sign in|log in/i.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));
  const tel = await p.$$eval('a[href^="tel:"]', (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  check("home: call links go to the public number", tel.length > 0 && tel.every((t) => t === "tel:+18457777585"), tel.join(","));

  // Text updates sign-up
  await p.goto(BASE + "/text-alerts");
  const boxes = await p.$$eval('input[type=checkbox]', (bs) => bs.map((x) => x.checked));
  check("sign-up: both boxes start unchecked", boxes.length === 2 && boxes.every((x) => !x));
  await p.fill('input[name=phone]', `(845) 555-${PHONE4}`);
  await p.click("button[type=submit]");
  await p.waitForTimeout(1500);
  check("sign-up: refuses with no box checked", /check at least one box/i.test(await p.content()));
  await p.check('input[name=marketing]');
  await p.selectOption('select[name=timeZone]', "");
  await p.click("button[type=submit]");
  await p.waitForTimeout(1500);
  check("sign-up: promotions require a time zone", /choose your time zone/i.test(await p.content()));
  await p.check('input[name=transactional]');
  await p.check('input[name=marketing]');
  await p.fill('input[name=phone]', `(845) 555-${PHONE4}`);
  await p.selectOption('select[name=timeZone]', "America/New_York");
  await p.click("button[type=submit]");
  await p.waitForSelector("[data-signup-done]", { timeout: 15000 }).catch(() => {});
  check("sign-up: success message", Boolean(await p.$("[data-signup-done]")));
  const c = await q("select scope, action, source, method, wording_version, ip is not null as has_ip from sms_consents where phone = $1 order by id", [E164]);
  check("sign-up: two separate consent records (order + promo) with source web", c.length === 2 && c.every((r) => r.action === "opt_in" && r.source === "web" && r.method === "checkbox"), JSON.stringify(c.map((r) => r.scope)));
  const tz = await q("select time_zone, time_zone_source, marketing_opt_in from customers where phone = $1", [E164]);
  check("sign-up: time zone and promo flag saved", tz[0]?.time_zone === "America/New_York" && tz[0]?.marketing_opt_in === true);
  const m = await q("select event, kind, status from messages where contact_phone = $1 and direction = 'out' order by id", [E164]);
  check("sign-up: one confirmation text per program", m.length === 2 && m.every((r) => r.event === "consent_confirmation"), JSON.stringify(m));
  await b.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => (console.error(e), process.exit(1)));
