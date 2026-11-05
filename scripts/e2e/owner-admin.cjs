// E2E: the Owner in the admin (in-memory DB, dev mode shows the sign-in code). Usage: node scripts/e2e/owner-admin.cjs
const { chromium } = require("playwright");
const q = require("./q.cjs");
const BASE = process.env.E2E_BASE || "http://localhost:3100";
const results = [];
const check = (name, ok, info = "") => (results.push({ name, ok }), console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`));

async function signIn(page, phone = "(845) 777-7585") {
  await page.goto(BASE + "/admin/login");
  await page.fill('input[inputmode="tel"]', phone);
  await page.getByRole("button", { name: "Send code" }).click();
  const codeEl = await page.waitForSelector("text=/Dev mode code/", { timeout: 30000 });
  const code = (await codeEl.textContent()).match(/\d{6}/)[0];
  await page.fill('input[inputmode="numeric"]', code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30000 });
}
module.exports.signIn = signIn;

const broken = async (page) => /Application error|Unhandled Runtime Error|Internal Server Error|This page could not be found/i.test(await page.innerText("body"));

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1280, height: 900 } });

  const anon = await page.goto(BASE + "/admin/orders");
  check("admin is protected: signed-out visit goes to the sign-in page", page.url().includes("/admin/login"), String(anon.status()));
  await signIn(page);
  check("owner signs in with a texted code", page.url().startsWith(BASE + "/admin"));
  const sent = await q("select count(*)::int n from login_codes");
  check("sign-in code was issued (stored hashed)", sent[0].n >= 1);

  for (const path of ["/admin", "/admin/calendar", "/admin/orders", "/admin/pos", "/admin/catalog", "/admin/calls", "/admin/phone/prompts", "/admin/compliance", "/admin/settings", "/admin/design"]) {
    const r = await page.goto(BASE + path);
    check(`page ${path} works`, r.status() === 200 && !(await broken(page)), String(r.status()));
  }

  // New booking at the POS for a customer without text consent: the link must not be texted.
  await page.goto(BASE + "/admin/pos");
  const d = new Date(Date.now() + (40 + Math.floor(Math.random() * 200)) * 86400e3).toISOString().slice(0, 10);
  await page.fill('input[type="date"]', d);
  await page.waitForSelector('button:has-text("+"):not([disabled])', { timeout: 60000 });
  await page.locator('button:has-text("+"):not([disabled])').first().click();
  await page.fill('input[placeholder="Full name *"]', "Pos Customer");
  const posPhone = `(845) 555-${String(2000 + Math.floor(Math.random() * 7999))}`;
  await page.fill('input[placeholder="Mobile phone"]', posPhone);
  await page.fill('input[placeholder="Delivery address"]', "3 Garfield Rd, Kiryas Joel");
  const linkBtn = page.locator("button", { hasText: /link/i }).first();
  if (await linkBtn.count()) await linkBtn.click();
  await page.locator("button.btn.w-full").last().click();
  await page.waitForTimeout(3000);
  const posMsg = await page.content();
  check("POS: booking created", /Booked order #/i.test(posMsg));
  check("POS: no text consent, so the link is not texted (staff told to call or email)", /No text consent; call or email|emailed/i.test(posMsg));

  const e164 = "+1" + posPhone.replace(/\D/g, "");
  const order = (await q("select o.id from orders o join customers c on c.id = o.customer_id where c.phone = $1 order by o.id desc limit 1", [e164]))[0];
  check("POS: order saved for the customer", Boolean(order));

  // Order page: consent status, record consent after reading the disclosure, then text the pay link.
  await page.goto(`${BASE}/admin/orders/${order.id}`);
  check("order page: shows 'No text consent; call or email.'", (await page.textContent("[data-text-consent]"))?.includes("No text consent; call or email."));
  await page.getByText("Customer clearly said yes").click();
  const saveBtn = page.getByRole("button", { name: "Record answer" });
  check("consent panel: can't save a yes until the full disclosure is confirmed read", await saveBtn.isDisabled());
  await page.getByText("I read the entire disclosure above to the customer, word for word.").click();
  await saveBtn.click();
  await page.waitForSelector("text=/Recorded: customer agreed to order texts/", { timeout: 20000 });
  check("consent panel: staff-recorded order-text consent saved", true);
  const sc = await q("select source, method, disclosure_read, user_id from sms_consents where phone = $1 order by id desc limit 1", [e164]);
  check("consent record: staff source, disclosure read", sc[0]?.source === "staff" && sc[0]?.disclosure_read === true);
  const audit = await q("select count(*)::int n from audit_log where action = 'sms_consent.staff_recorded'");
  check("audit log: staff consent recorded", audit[0].n >= 1);
  await page.reload();
  const pay = page.getByRole("button", { name: /text payment link|send payment link|payment link/i }).first();
  if (await pay.count()) {
    await pay.click();
    await page.waitForTimeout(2500);
    check("order page: payment link now texted", /Payment link texted/i.test(await page.content()));
  } else check("order page: payment link button present", false);

  // Compliance page: owner review + report an issue
  await page.goto(BASE + "/admin/compliance");
  check("compliance: owner sees the review, checks, and employee access", /Periodic review/.test(await page.content()) && /Automatic checks/.test(await page.content()));
  await page.locator("textarea").last().fill("E2E test report: please ignore.");
  await page.getByRole("button", { name: "Report to the owner now" }).last().click();
  await page.waitForSelector("text=/The owner has been notified/", { timeout: 20000 }).catch(() => {});
  check("compliance: issue report sent to the owner", /The owner has been notified/.test(await page.content()));

  // Phone layout: sidebar collapses, no sideways scroll
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.context().addCookies(await page.context().cookies());
  for (const path of ["/admin", "/admin/orders", `/admin/orders/${order.id}`, "/admin/design"]) {
    await m.goto(BASE + path);
    check(`phone layout ${path}: no sideways scroll`, !(await m.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
  }

  await b.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => (console.error(e), process.exit(1)));
