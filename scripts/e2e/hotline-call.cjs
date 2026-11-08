// E2E: a customer calling the hotline, start to payment, against the running app (in-memory DB).
// Acts like Twilio: signs every webhook, follows <Redirect>, answers each <Gather>. Usage: node scripts/e2e/hotline-call.cjs
const twilio = require("twilio");
const crypto = require("node:crypto");
const q = require("./q.cjs");
const BASE = process.env.PUBLIC_BASE_URL || "http://localhost:3100";
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const results = [];
const check = (name, ok, info = "") => (results.push({ name, ok }), console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`));

async function post(url, params) {
  const full = url.startsWith("http") ? url : BASE + url;
  const sig = twilio.getExpectedTwilioSignature(TOKEN, full, params);
  const r = await fetch(full, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": sig }, body: new URLSearchParams(params) });
  return { status: r.status, text: await r.text() };
}

/** Run a call: `answers` is a list of input objects consumed in order at each <Gather>. */
async function call(callSid, from, answers, { stopAfterGathers = Infinity } = {}) {
  const said = [];
  let res = await post("/api/voice/incoming", { CallSid: callSid, From: from, To: "+18454157585" });
  let gathers = 0;
  for (let guard = 0; guard < 120; guard++) {
    if (res.status !== 200) return { said, error: `HTTP ${res.status}` };
    const xml = res.text;
    for (const m of xml.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)) said.push(m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
    if (/<Hangup\/>/.test(xml)) return { said, hungUp: true };
    const g = xml.match(/<Gather[^>]*action="([^"]+)"/);
    if (g && gathers < stopAfterGathers && answers.length) {
      gathers++;
      const a = answers.shift();
      res = await post(g[1].replace(/&amp;/g, "&"), { CallSid: callSid, From: from, ...a });
      continue;
    }
    const r = xml.match(/<Redirect[^>]*>([^<]+)<\/Redirect>/);
    if (r && !g) {
      res = await post(r[1].replace(/&amp;/g, "&"), { CallSid: callSid, From: from });
      continue;
    }
    return { said, open: true, xml };
  }
  return { said, error: "too many steps" };
}

// Ordinary open weekdays (not Shabbos, Yom Tov, Purim or Tisha B'Av, with an open next day), so the test isn't
// tripped by the Jewish-calendar rules. Each run picks at random so earlier runs don't hold the stock.
const OPEN_DAYS = ["2027-01-12", "2027-01-13", "2027-01-19", "2027-01-20", "2027-01-26", "2027-01-27", "2027-02-02", "2027-02-03", "2027-02-09", "2027-02-10", "2027-02-16", "2027-02-17", "2027-02-23", "2027-02-24", "2027-03-02", "2027-03-03", "2027-03-09", "2027-03-10", "2027-05-04", "2027-05-05", "2027-05-11", "2027-05-12", "2027-06-01", "2027-06-02", "2027-07-06", "2027-07-07"];
const openDay = () => {
  const iso = OPEN_DAYS[Math.floor(Math.random() * OPEN_DAYS.length)];
  return { iso, mmdd: iso.slice(5, 7) + iso.slice(8, 10) };
};
const addDays = (n) => {
  const d = new Date(Date.now() + n * 86400e3);
  return { mmdd: `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`, iso: d.toISOString().slice(0, 10) };
};

(async () => {
  const caller = `+1845555${String(1000 + Math.floor(Math.random() * 8999))}`;
  const date = openDay();

  // 1. Full booking: Jumping Balloons -> first item -> add -> date -> qty 1 -> checkout -> consent -> terms -> pay link
  const sid1 = "CAe2e" + crypto.randomBytes(4).toString("hex");
  const run = await call(sid1, caller, [
    { Digits: "1" }, // main menu: bookings (Abraham's menu)
    { Digits: "1" }, // rental list: category 1
    { Digits: "1" }, // first item
    { Digits: "2" }, // add to cart
    { Digits: date.mmdd }, // date by keypad
    { Digits: "1" }, // confirm date
    { Digits: "1" }, // quantity 1 (if asked)
    { Digits: "9" }, // check out
    { Digits: "1" }, // cart: check out
    { SpeechResult: "Yossi Friedman", Confidence: "0.9" },
    { Digits: "1" }, // name ok
    { SpeechResult: "12 Forest Road Kiryas Joel", Confidence: "0.9" },
    { Digits: "1" }, // address ok
    { Digits: "" }, // skip email
    { Digits: "1" }, // text this number
    { Digits: "1" }, // order texts: yes
    { Digits: "#" }, // terms
    { Digits: "2" }, // promos: no
  ]);
  const all = run.said.join(" | ");
  if (process.env.E2E_DEBUG) console.log("DEBUG", JSON.stringify({ error: run.error, open: run.open, hungUp: run.hungUp, said: run.said.slice(0, 4), xml: (run.xml || "").slice(0, 300) }));
  check("call: greeting and menu spoken", /Thank you for calling Hup Up Attractions/i.test(all) && /For reservations and bookings, press 1/i.test(all) && /For schools, corporate events, and organizational bookings, press 8/i.test(all) && /For Jumping Balloons, press 1/i.test(all));
  check("call: item added, held for the call", /I added one/i.test(all));
  check("call: order-text consent question asked", /Can Hup Up Attractions text you at this number/i.test(all));
  check("call: terms notice played", all.includes("By pressing #, you agree to our Terms and Conditions"));
  check("call: total read back with delivery and tax", /Your total is .* for delivery, and .* sales tax/i.test(all));
  check("call: ends politely and hangs up", run.hungUp && /Thanks so much for choosing Hup Up Attractions/.test(all), run.error || "");

  const o = (await q("select o.*, c.phone, c.name from orders o join customers c on c.id = o.customer_id where c.phone = $1 order by o.id desc limit 1", [caller]))[0];
  check("order: pending payment, 15-minute hold", o?.status === "PENDING_PAYMENT" && Math.abs(new Date(o.hold_expires_at) - Date.now() - 15 * 60e3) < 90e3, o?.status);
  check("order: KJ zone, $10 delivery, 8.125% tax on items + delivery", o?.delivery_zone === "kj" && o.delivery_fee_cents === 1000 && o.tax_cents === Math.round(((o.subtotal_cents + 1000) * 8125) / 100000) && o.total_cents === o.subtotal_cents + 1000 + o.tax_cents, o && `${o.subtotal_cents}+${o.delivery_fee_cents}+${o.tax_cents}=${o.total_cents}`);
  const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
  const next = new Date(Date.parse(date.iso + "T00:00:00Z") + 86400e3).toISOString().slice(0, 10);
  check("order: event day + next-day pickup", o && iso(o.event_date) === date.iso && iso(o.pickup_date) === next, o && `${iso(o.event_date)} / ${iso(o.pickup_date)}`);
  const t = (await q("select terms_version, method, phone from terms_acceptances where order_id = $1", [o?.id]));
  check("terms: acceptance logged with version, phone, order", t.length === 1 && t[0].method === "phone_hash" && t[0].phone === caller);
  const c = (await q("select scope, action, method from sms_consents where phone = $1 order by id", [caller]));
  check("consent: order texts yes (keypad), promos declined", c.some((x) => x.scope === "transactional" && x.action === "opt_in" && x.method === "keypad") && c.some((x) => x.scope === "marketing" && x.action === "declined"));
  const m = (await q("select body, status from messages where contact_phone = $1 and event = 'order_payment_link' and order_id = $2", [caller, o?.id]))[0];
  const amt = m?.body.match(/total \$(\d+\.\d{2})/)?.[1];
  check("payment text: sent with breakdown and HELP/STOP footer", Boolean(m) && /Rentals \$.* \+ delivery \$10\.00 \+ sales tax \$/.test(m.body) && /STOP to opt out/.test(m.body), m?.status);
  const link = m?.body.match(/https?:\/\/\S+/)?.[0] || "";
  check("payment text: links to the review-and-pay page", /\/pay\/\d+\?t=/.test(link), link.slice(0, 80));
  // Customer opens the link: unchecked Terms box required, then continue to Sola (intercepted, never leaves this machine)
  const { chromium } = require("playwright");
  const br = await chromium.launch();
  const pg = await br.newPage();
  let solaUrl = "";
  await pg.route("https://secure.cardknox.com/**", (r) => ((solaUrl = r.request().url()), r.abort()));
  await pg.goto(link.replace(/[.,]$/, ""));
  const box = pg.locator('input[name="agree"]');
  check("pay page: Terms box starts unchecked; pay button disabled", !(await box.isChecked()) && (await pg.getByRole("button", { name: "Continue to secure payment" }).isDisabled()));
  await box.check();
  await pg.getByRole("button", { name: "Continue to secure payment" }).click();
  for (let i = 0; i < 40 && !solaUrl; i++) await pg.waitForTimeout(250);
  await br.close();
  check("payment link: Sola charges items + delivery + tax", solaUrl.includes(`xAmount=${(o.total_cents / 100).toFixed(2)}`) && amt === (o.total_cents / 100).toFixed(2), solaUrl.slice(0, 90));
  const acc = await q("select method from terms_acceptances where order_id = $1 order by id", [o.id]);
  check("terms: phone # and website checkbox acceptances both logged", acc.map((x) => x.method).join(",") === "phone_hash,web_checkbox");
  const tv = await q("select version, effective_date from terms_versions");
  check("terms: a copy of the accepted version is stored", tv.length >= 1);
  const invoice = new URL(solaUrl || "http://x/?xInvoice=").searchParams.get("xInvoice");
  const fields = { xResult: "A", xInvoice: invoice, xAuthAmount: (o.total_cents / 100).toFixed(2), xRefNum: "R" + o.id };
  const lowered = Object.entries(fields).map(([k, v]) => [k.toLowerCase(), v]).sort(([a], [b]) => (a < b ? -1 : 1));
  const sig = crypto.createHash("md5").update(lowered.map(([, v]) => v).join("") + process.env.SOLA_WEBHOOK_PIN).digest("hex");
  const pay = await fetch(BASE + "/api/sola/webhook", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "ck-signature": sig }, body: new URLSearchParams(fields) });
  const o2 = (await q("select status, paid_cents from orders where id = $1", [o.id]))[0];
  check("payment: Sola webhook confirms the order", pay.status === 200 && o2.status === "CONFIRMED" && o2.paid_cents === o.total_cents, `${pay.status} ${o2.status} ${o2.paid_cents}`);
  const conf = (await q("select status from messages where contact_phone = $1 and event = 'payment_confirmation' and order_id = $2", [caller, o.id]))[0];
  check("payment: confirmation text sent (customer has order-text consent)", conf?.status === "dev");
  const aud = (await q("select action from audit_log where entity_type = 'order' and entity_id = $1", [String(o.id)]));
  check("payment: tied to the accepted terms in the audit log", aud.some((a) => a.action === "payment.terms_accepted"));

  // 3. Out-of-area address stops checkout
  const sid2 = "CAe2e" + crypto.randomBytes(4).toString("hex");
  const run2 = await call(sid2, "+18455550143", [
    { Digits: "1" }, { Digits: "1" }, { Digits: "1" }, { Digits: "2" }, { Digits: openDay().mmdd }, { Digits: "1" }, { Digits: "1" }, { Digits: "9" }, { Digits: "1" },
    { SpeechResult: "Sam Green", Confidence: "0.9" }, { Digits: "1" },
    { SpeechResult: "5 Main Street Albany", Confidence: "0.9" }, { Digits: "1" },
  ], { stopAfterGathers: 13 });
  check("out of area: checkout stops and asks for an in-area address", run2.said.join(" ").includes("we only deliver in Kiryas Joel and nearby Orange County towns"));

  // 4. Hanging up releases the held items
  const sid3 = "CAe2e" + crypto.randomBytes(4).toString("hex");
  await call(sid3, "+18455550144", [{ Digits: "1" }, { Digits: "3" }, { Digits: "1" }, { Digits: "2" }, { Digits: openDay().mmdd }, { Digits: "1" }, { Digits: "1" }], { stopAfterGathers: 7 });
  const held = (await q("select o.id, o.status from orders o join call_sessions s on s.order_id = o.id where s.call_sid = $1", [sid3]))[0];
  await post("/api/voice/status", { CallSid: sid3, CallStatus: "completed" });
  const after = held ? (await q("select status from orders where id = $1", [held.id]))[0] : null;
  check("hang-up: held cart is released", held?.status === "HOLD" && after?.status === "CANCELLED", `${held?.status} -> ${after?.status}`);

  // 5. Unsigned webhook is rejected
  const bad = await fetch(BASE + "/api/voice/incoming", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "CallSid=x&From=%2B1" });
  check("security: unsigned Twilio webhook rejected", bad.status === 403, String(bad.status));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => (console.error(e), process.exit(1)));
