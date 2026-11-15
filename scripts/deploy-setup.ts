import "dotenv/config";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Runs during each Vercel build, after the database steps (Abraham, Nov 15, 2026). Never fails the build and never
 * prints a secret: only names, yes/no answers, HTTP status codes and Cloudflare's or Twilio's own error text.
 *
 * 1. Payment line check (live builds): the "Hup Up Payments" Twilio subaccount's SIP domain must send its calls to
 *    /api/pay-voice/incoming on our site, and its credential list must hold our SIP username. A wrong voice URL is
 *    corrected; everything else is reported in the build log.
 * 2. Cloudflare (live builds): the free scheduler Worker (cloudflare/scheduler-worker.js) is put on Cloudflare with a
 *    5-minute schedule, and the delivery photos bucket is created in R2 if it is missing. Workers and R2 only, within
 *    the free tier; no DNS and no routes on the domain. Uses CLOUDFLARE_R2_WORKERS_TOKEN and CLOUDFLARE_ACCOUNT_ID.
 */
const log = (m: string) => console.log(`[setup] ${m}`);
const T = (ms: number) => AbortSignal.timeout(ms);
export const R2_PHOTOS_BUCKET = "hupup-delivery-photos";
export const SCHEDULER_NAME = "hupup-scheduler";

async function twilioPayCheck(env: NodeJS.ProcessEnv) {
  const sid = env.TWILIO_PAY_ACCOUNT_SID;
  const token = env.TWILIO_PAY_AUTH_TOKEN;
  const domainName = (env.TWILIO_PAY_SIP_DOMAIN || "").toLowerCase();
  if (!sid || !token || !domainName) return log("Payment line: subaccount settings are not all in Vercel yet.");
  const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
  const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`;
  const get = async (path: string) => {
    const r = await fetch(`${base}${path}`, { headers: { authorization: auth }, signal: T(15000) });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  const d = await get("/SIP/Domains.json?PageSize=50");
  if (d.status !== 200) return log(`Payment line: Twilio answered ${d.status} when listing SIP domains (check the subaccount SID and token).`);
  const domains = (d.json.domains as { sid: string; domain_name: string; voice_url: string | null; voice_method: string | null }[]) ?? [];
  const dom = domains.find((x) => x.domain_name.toLowerCase() === domainName);
  if (!dom) return log(`Payment line: no SIP domain named ${domainName} in the subaccount (found ${domains.length}).`);
  const want = `${(env.PUBLIC_BASE_URL || "https://hupupattractions.com").replace(/\/$/, "")}/api/pay-voice/incoming`;
  if (dom.voice_url !== want || (dom.voice_method || "").toUpperCase() !== "POST") {
    const r = await fetch(`${base}/SIP/Domains/${dom.sid}.json`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ VoiceUrl: want, VoiceMethod: "POST" }),
      signal: T(15000),
    });
    log(`Payment line: SIP domain voice URL was ${dom.voice_url || "empty"}; set to ${want}: ${r.status === 200 ? "done" : `Twilio answered ${r.status}`}.`);
  } else log("Payment line: SIP domain voice URL is correct.");
  const maps = await get(`/SIP/Domains/${dom.sid}/Auth/Calls/CredentialListMappings.json`);
  const lists = (maps.json.contents as { sid: string }[]) ?? [];
  if (!lists.length) return log("Payment line: the SIP domain has no credential list for calls, so the hotline cannot sign in to it.");
  let found = false;
  for (const l of lists) {
    const c = await get(`/SIP/CredentialLists/${l.sid}/Credentials.json`);
    if (((c.json.credentials as { username: string }[]) ?? []).some((x) => x.username === env.TWILIO_PAY_SIP_USERNAME)) found = true;
  }
  log(`Payment line: our SIP username is ${found ? "" : "NOT "}in the domain's credential list.`);
}

async function cloudflareSetup(env: NodeJS.ProcessEnv) {
  const token = env.CLOUDFLARE_R2_WORKERS_TOKEN || env.CLOUDFLARE_API_TOKEN;
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !account) return log("Cloudflare: token or account ID is not in Vercel yet.");
  const cf = async (method: string, path: string, body?: BodyInit, type?: string) => {
    const r = await fetch(`https://api.cloudflare.com/client/v4${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(type ? { "content-type": type } : {}) }, body, signal: T(20000) });
    const j = (await r.json().catch(() => ({}))) as { success?: boolean; errors?: { message?: string }[]; result?: unknown };
    return { status: r.status, ok: r.ok && j.success !== false, errors: (j.errors ?? []).map((e) => e.message).join("; "), result: j.result };
  };
  const v = await cf("GET", `/accounts/${account}/tokens/verify`);
  const v2 = v.ok ? v : await cf("GET", "/user/tokens/verify");
  log(`Cloudflare: token check ${v2.ok ? "passed" : `failed (${v2.status} ${v2.errors})`}.`);

  // Scheduler Worker, every 5 minutes (free plan; no routes, no DNS)
  if (!env.CRON_SECRET) log("Cloudflare: CRON_SECRET is missing, so the scheduler is not uploaded.");
  else {
    const code = readFileSync(join(process.cwd(), "cloudflare/scheduler-worker.js"), "utf8");
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({
        main_module: "scheduler-worker.js",
        compatibility_date: "2026-11-01",
        bindings: [
          { type: "plain_text", name: "SITE_URL", text: env.PUBLIC_BASE_URL || "https://hupupattractions.com" },
          { type: "secret_text", name: "CRON_SECRET", text: env.CRON_SECRET },
        ],
      }),
    );
    form.append("scheduler-worker.js", new Blob([code], { type: "application/javascript+module" }), "scheduler-worker.js");
    const up = await cf("PUT", `/accounts/${account}/workers/scripts/${SCHEDULER_NAME}`, form);
    log(`Cloudflare: scheduler Worker upload ${up.ok ? "done" : `failed (${up.status} ${up.errors})`} (code ${createHash("sha256").update(code).digest("hex").slice(0, 8)}).`);
    if (up.ok) {
      const setSchedule = () => cf("PUT", `/accounts/${account}/workers/scripts/${SCHEDULER_NAME}/schedules`, JSON.stringify([{ cron: "*/5 * * * *" }]), "application/json");
      let sch = await setSchedule();
      // A new Workers account needs its free workers.dev name first (Cloudflare's own address; not our domain or DNS)
      if (!sch.ok && /workers\.dev subdomain/i.test(sch.errors)) {
        const sub = await cf("PUT", `/accounts/${account}/workers/subdomain`, JSON.stringify({ subdomain: "hupup-attractions" }), "application/json");
        log(`Cloudflare: free workers.dev name ${sub.ok ? "created" : `could not be created (${sub.status} ${sub.errors})`}.`);
        if (sub.ok) sch = await setSchedule();
      }
      log(`Cloudflare: every-5-minutes schedule ${sch.ok ? "set" : `failed (${sch.status} ${sch.errors})`}.`);
    }
  }

  // Delivery photos bucket (R2 free tier: 10 GB stored a month)
  const b = await cf("GET", `/accounts/${account}/r2/buckets/${R2_PHOTOS_BUCKET}`);
  if (b.ok) log(`Cloudflare: R2 bucket ${R2_PHOTOS_BUCKET} is there.`);
  else {
    const c = await cf("POST", `/accounts/${account}/r2/buckets`, JSON.stringify({ name: R2_PHOTOS_BUCKET }), "application/json");
    log(`Cloudflare: R2 bucket ${R2_PHOTOS_BUCKET} ${c.ok ? "created" : `could not be created (${c.status} ${c.errors})`}.`);
  }
}

/** What the live line is set to (business numbers only, last 4 digits for test phones; no secrets). */
async function liveSettingsReport() {
  const { getDb, schema } = await import("../src/lib/db");
  const rows = await getDb().select().from(schema.appSettings);
  const v = (k: string) => rows.find((r) => r.key === k)?.value;
  const nums = (x: unknown) => String(x ?? "").match(/\+1\d{10}/g)?.map((n) => `(${n.slice(2, 5)}) ${n.slice(5, 8)}-${n.slice(8)}`).join(", ") || "none";
  log(`Live line: key 6 Delivery/Pickup rings ${nums(v("ringTargets6"))}; key 3 customer service rings ${nums(v("ringTargets4"))}.`);
  log(`Live line: card payments ${v("solaPhonePayOn") === true ? "on" : "off"} through ${v("phoneCardProvider") ?? "sola"}, ${v("solaPhonePayOwnerOnly") === false ? "for every caller" : `test numbers only (${nums(v("paymentTestNumbers")).replace(/\(\d{3}\) \d{3}-/g, "ending ")})`}.`);
}

/**
 * Delivery price map (Abraham, Nov 15, 2026): load the shapes from his Google map, then test one real address inside
 * each area: a point inside the shape is turned into a street address (OpenStreetMap), and that address is priced the
 * way a booking is. The results go in the build log.
 */
async function deliveryMapCheck() {
  const { reloadDeliveryMap, pointInside, deliveryQuote, priceFor } = await import("../src/lib/delivery-areas");
  const { getSettings } = await import("../src/lib/settings");
  const r = await reloadDeliveryMap();
  log(`Delivery map: ${r.message}`);
  if (!r.ok || !r.areas) return;
  const s = await getSettings();
  for (const a of r.areas) {
    const p = pointInside(a);
    if (!p) {
      log(`Delivery map test: ${a.name}: no point inside the shape.`);
      continue;
    }
    const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${p[1]}&lon=${p[0]}`, { headers: { "user-agent": "HupUpAttractionsBookings/1.0" }, signal: AbortSignal.timeout(10000) })
      .then((x) => x.json() as Promise<{ address?: Record<string, string> }>)
      .catch(() => ({ address: undefined }));
    const ad = rev.address ?? {};
    const street = [ad.house_number, ad.road].filter(Boolean).join(" ");
    const town = ad.village || ad.town || ad.city || ad.hamlet || "";
    const address = street && town ? `${street}, ${town}, NY ${ad.postcode ?? ""}`.trim() : null;
    if (!address) {
      log(`Delivery map test: ${a.name} ($${((a.priceCents ?? 0) / 100).toFixed(2)}): no street address found inside it.`);
      continue;
    }
    const q = await deliveryQuote(address, s);
    const want = priceFor(a);
    const pass = q.ok && q.feeCents === want;
    log(`Delivery map test: ${a.name} (rule price $${(want / 100).toFixed(2)}): "${address}" -> ${q.ok ? `${q.zone}, $${(q.feeCents / 100).toFixed(2)}` : `no price (${q.reason})`} ${pass ? "PASS" : "CHECK"}`);
    await new Promise((x) => setTimeout(x, 1100)); // OpenStreetMap asks for at most 1 lookup a second
  }
  // Check against Hark's sheet of streets that cross a zone line (only to check; it never sets a price). One house in
  // the middle of every few rows is priced the way a booking is, and compared with the sheet.
  const { readFileSync } = await import("node:fs");
  type Row = { street: string; zip: string; town: string; side: string; from: number; to: number; cents: number; area: string };
  const sheet = JSON.parse(readFileSync("scripts/data/delivery-price-check.json", "utf8")) as Row[];
  const sample = sheet.filter((_, k) => k % 8 === 0);
  const houseIn = (r: Row) => {
    let n = Math.round((r.from + r.to) / 2);
    if ((n % 2 === 0) !== (r.side.toLowerCase() === "even")) n += 1;
    return n > r.to ? r.from : n;
  };
  let agree = 0;
  const differ: string[] = [];
  const priced = new Map<string, { address: string; cents: number; zone: string }[]>();
  for (const r of sample) {
    const address = `${houseIn(r)} ${r.street}, ${r.town}, NY ${r.zip}`;
    const q = await deliveryQuote(address, s);
    if (!q.ok) {
      differ.push(`"${address}": sheet $${r.cents / 100} (${r.area}), ours not found`);
      continue;
    }
    if (q.feeCents === r.cents) agree++;
    else differ.push(`"${address}": sheet $${r.cents / 100} (${r.area}), ours $${q.feeCents / 100} (${q.zone})`);
    priced.set(r.street, [...(priced.get(r.street) ?? []), { address, cents: q.feeCents, zone: q.zone }]);
  }
  log(`Delivery map check against Hark's sheet: ${agree} of ${sample.length} houses agree.`);
  for (const d of differ.slice(0, 15)) log(`Delivery map check, differs: ${d}`);
  // Two houses on the same street with different prices
  const pair = [...priced.values()].find((list) => new Set(list.map((x) => x.cents)).size > 1);
  if (pair) {
    const a = pair[0];
    const b = pair.find((x) => x.cents !== a.cents)!;
    log(`Delivery map test, same street: "${a.address}" -> ${a.zone}, $${(a.cents / 100).toFixed(2)}; "${b.address}" -> ${b.zone}, $${(b.cents / 100).toFixed(2)} PASS`);
  } else log("Delivery map test, same street: no pair in this sample.");
  for (const out of ["25 Main Street, Goshen, NY 10924"]) {
    const q = await deliveryQuote(out, s);
    log(`Delivery map test: outside every colored area "${out}" -> ${q.ok ? `$${(q.feeCents / 100).toFixed(2)} ${q.feeCents === 2000 ? "PASS" : "CHECK"}` : `no price (${q.reason}) CHECK`}`);
  }
}

async function main() {
  if (process.env.VERCEL_ENV !== "production") return log("Not a live build: payment line check and Cloudflare setup skipped.");
  for (const [name, step] of [
    ["Payment line check", twilioPayCheck],
    ["Cloudflare setup", cloudflareSetup],
    ["Delivery map", deliveryMapCheck],
    ["Live line report", liveSettingsReport],
  ] as const) {
    try {
      await step(process.env);
    } catch (e) {
      log(`${name}: stopped (${(e as Error).name}: ${(e as Error).message.slice(0, 160)}). The build carries on.`);
    }
  }
}

main().catch(() => undefined);
