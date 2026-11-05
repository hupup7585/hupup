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

const addDays = (n) => {
  const d = new Date(Date.now() + n * 86400e3);
  return { mmdd: `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`, iso: d.toISOString().slice(0, 10) };
};

(async () => {
  const caller = `+1845555${String(1000 + Math.floor(Math.random() * 8999))}`;
  const date = addDays(20 + Math.floor(Math.random() * 300)); // a fresh date each run (earlier runs may hold the stock)

  // 1. Full booking: Jumping Balloons -> first item -> add -> date -> qty 1 -> checkout -> consent -> terms -> pay link
  const sid1 = "CAe2e" + crypto.randomBytes(4).toString("hex");
  const run = await call(sid1, caller, [
    { Digits: "1" }, // menu: category 1
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
  check("call: greeting and menu spoken", /thanks for calling Hup Up Attractions/i.test(all) && /For Jumping Balloons, press 1/i.test(all));
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
  check("payment link: charges items + delivery + tax", link.includes(`xAmount=${(o.total_cents / 100).toFixed(2)}`) && amt === (o.total_cents / 100).toFixed(2), link.slice(0, 90));

  // 2. Sola says paid -> order confirmed, confirmation text, terms linked to the payment
  const invoice = new URL(link).searchParams.get("xInvoice");
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
    { Digits: "1" }, { Digits: "1" }, { Digits: "2" }, { Digits: addDays(20 + Math.floor(Math.random() * 300)).mmdd }, { Digits: "1" }, { Digits: "1" }, { Digits: "9" }, { Digits: "1" },
    { SpeechResult: "Sam Green", Confidence: "0.9" }, { Digits: "1" },
    { SpeechResult: "5 Main Street Albany", Confidence: "0.9" }, { Digits: "1" },
  ], { stopAfterGathers: 12 });
  check("out of area: checkout stops and asks for an in-area address", run2.said.join(" ").includes("we only deliver in Kiryas Joel and nearby Orange County towns"));

  // 4. Hanging up releases the held items
  const sid3 = "CAe2e" + crypto.randomBytes(4).toString("hex");
  await call(sid3, "+18455550144", [{ Digits: "3" }, { Digits: "1" }, { Digits: "2" }, { Digits: addDays(20 + Math.floor(Math.random() * 300)).mmdd }, { Digits: "1" }, { Digits: "1" }], { stopAfterGathers: 6 });
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
