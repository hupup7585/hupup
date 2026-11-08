// E2E: Secretary and Delivery accounts (created by the Owner), sign-in methods, role gates, delivery screen.
// Usage: node scripts/e2e/staff-roles.cjs   (in-memory DB; dev mode shows sign-in codes)
const { chromium } = require("playwright");
const q = require("./q.cjs");
const BASE = process.env.E2E_BASE || "http://localhost:3100";
const results = [];
const check = (name, ok, info = "") => (results.push({ name, ok }), console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`));
const rnd = () => String(1000 + Math.floor(Math.random() * 8999));

async function codeSignIn(page, phone) {
  await page.goto(BASE + "/admin/login");
  await page.fill('input[inputmode="tel"]', phone);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  const el = await page.waitForSelector("text=/Dev mode code/", { timeout: 30000 });
  await page.fill('input[inputmode="numeric"]', (await el.textContent()).match(/\d{6}/)[0]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/admin/login"), { timeout: 30000 });
}

(async () => {
  const b = await chromium.launch();
  const owner = await (await b.newContext()).newPage();
  await codeSignIn(owner, "(845) 777-7585");

  // Owner creates a Secretary (with password) and a Delivery account
  const tag = rnd();
  const SEC = `Sara Secretary ${tag}`;
  const DRV = `Dovid Driver ${tag}`;
  const secPhone = `(845) 555-${rnd()}`;
  const delPhone = `(845) 555-${rnd()}`;
  await owner.goto(BASE + "/admin/staff");
  const add = async (name, phone, role, pw) => {
    await owner.getByLabel("Name").fill(name);
    await owner.getByLabel("Mobile number").fill(phone);
    await owner.getByLabel("Role").selectOption(role);
    if (pw) await owner.getByLabel(/Password \(optional/).fill(pw);
    await owner.getByRole("button", { name: "Add staff member" }).click();
    await owner.waitForSelector(`text=/Added ${name}/`, { timeout: 20000 });
  };
  await add(SEC, secPhone, "secretary", "correct-horse-battery");
  await add(DRV, delPhone, "delivery");
  check("owner: adds a Secretary (with password) and a Delivery account", true);

  // Secretary: password sign-in works; lands on Calendar; owner-only screens refused
  const sec = await (await b.newContext()).newPage();
  await sec.goto(BASE + "/admin/login");
  await sec.fill('input[inputmode="tel"]', secPhone);
  await sec.getByRole("tab", { name: "Use password" }).click();
  await sec.fill('input[type="password"]', "wrong-password-1");
  await sec.getByRole("button", { name: "Sign in" }).click();
  await sec.waitForSelector("text=/not correct/", { timeout: 20000 });
  check("secretary: wrong password refused", true);
  await sec.fill('input[type="password"]', "correct-horse-battery");
  await sec.getByRole("button", { name: "Sign in" }).click();
  await sec.waitForURL(/\/admin\/calendar/, { timeout: 30000 });
  check("secretary: password sign-in lands on the Calendar", true);
  for (const path of ["/admin/orders", "/admin/pos", "/admin/calls", "/admin/compliance", "/admin/deliveries"]) {
    await sec.goto(BASE + path);
    check(`secretary can open ${path}`, new URL(sec.url()).pathname === path);
  }
  for (const path of ["/admin", "/admin/settings", "/admin/staff", "/admin/catalog", "/admin/phone/prompts"]) {
    await sec.goto(BASE + path);
    check(`secretary is kept out of ${path}`, new URL(sec.url()).pathname !== path, new URL(sec.url()).pathname);
  }
  const csv = await sec.goto(BASE + "/api/admin/orders.csv");
  check("secretary can't download the finances CSV", csv.status() === 403, String(csv.status()));
  await sec.goto(BASE + "/admin/orders");
  const nav = await sec.innerText("aside");
  check("secretary's menu hides owner-only screens", !/Settings|Staff\b|Catalog|Dashboard/.test(nav));

  // Delivery: password refused, code sign-in, only the deliveries screen
  const del = await (await b.newContext()).newPage();
  await del.goto(BASE + "/admin/login");
  await del.fill('input[inputmode="tel"]', delPhone);
  await del.getByRole("tab", { name: "Use password" }).click();
  await del.fill('input[type="password"]', "anything-at-all-123");
  await del.getByRole("button", { name: "Sign in" }).click();
  await del.waitForSelector("text=/not correct|texted code/", { timeout: 20000 });
  check("delivery: password sign-in refused", true);
  await codeSignIn(del, delPhone);
  check("delivery: code sign-in lands on Deliveries", new URL(del.url()).pathname === "/admin/deliveries");
  for (const path of ["/admin/orders", "/admin/pos", "/admin/calendar", "/admin/settings", "/admin/compliance"]) {
    await del.goto(BASE + path);
    check(`delivery is kept out of ${path}`, new URL(del.url()).pathname === "/admin/deliveries");
  }

  // A confirmed order for a day: delivery stop appears without prices; mark delivered (audited)
  const day = (await q("select event_date::text d, id from orders where status = 'CONFIRMED' order by id desc limit 1"))[0];
  if (day) {
    await del.goto(`${BASE}/admin/deliveries?d=${day.d}`);
    const text = await del.innerText("main");
    check("delivery: stop shows customer, address and items", /Delivery · #/.test(text));
    check("delivery: no prices shown", !/\$\d/.test(text));
    const card = del.locator(`li[data-stop="delivery"]`).first();
    await card.getByRole("button", { name: "Send template text" }).click();
    await del.waitForTimeout(2500);
    check("delivery: template text goes through the consent check", /Sent: |No text consent|emailed/.test(await card.innerText()));
    await card.getByRole("button", { name: "Mark delivered" }).click();
    await del.waitForTimeout(2500);
    const st = (await q("select status from orders where id = $1", [day.id]))[0];
    check("delivery: Mark delivered updates the order", st.status === "DELIVERED", st.status);
    const a = await q("select count(*)::int n from audit_log where action = 'delivery.delivered' and entity_id = $1", [String(day.id)]);
    check("delivery: audited", a[0].n === 1);
  } else check("delivery: a confirmed order exists to deliver", false);

  // Owner deactivates the delivery account: signed out at once
  await owner.goto(BASE + "/admin/staff");
  await owner.locator("li", { hasText: DRV }).getByRole("button", { name: "Deactivate" }).click();
  await owner.waitForSelector("text=/deactivated and signed out/", { timeout: 20000 });
  await del.goto(BASE + "/admin/deliveries");
  check("deactivated account is signed out immediately", del.url().includes("/admin/login"));
  const audit = await q("select count(*)::int n from audit_log where action like 'login.%'");
  check("sign-in attempts are audited", audit[0].n >= 5);

  await b.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => (console.error(e), process.exit(1)));
