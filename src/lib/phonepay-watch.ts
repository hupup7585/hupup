import { signingSecret } from "@/lib/secret";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { BUSINESS_NAME, config } from "@/lib/config";
import { easternToDate, endMainPayLeg, isPhonePayInvoice, type SolaTxn } from "@/lib/sola-phonepay";
export { isPhonePayInvoice };

/*
 * Sola PhonePay safety (Abraham, Nov 17, 2026, Missing Items 4 and 5, Sola ticket 2026972).
 * Sola's line: PIN# > amount in cents# > 1 > card number# > expiration MMYY# > ZIP# > approved or declined, the ref
 * number, then Sola hangs up. After a decline Sola asks for a NEW amount, so a caller could key any amount. To stop that:
 *  - while the call to Sola is up, Sola's reporting API is checked every second for a charge of this try's amount
 *    (approved or declined) made since the try started; as soon as one shows, the call to Sola is hung up (Twilio REST),
 *    so the caller is back on our line before Sola's amount question;
 *  - no time limit (Abraham, Nov 18, 2026: the 4-minute timer is removed); the Sola hang-up helper (option a) times the
 *    hang-up at the end of Sola's sentence and runs the silence check; if the helper fails, the old timing is used;
 *  - a charge that is not the order total is voided and the Owner emailed (checkPhonePayTry, as before);
 *  - tries per call and declines per caller phone in 24 hours are Admin settings (3 and 5 to start); past the second,
 *    card payment by phone is blocked for that number, the Owner is emailed, and staff can unlock it in Admin.
 * Free: Vercel functions of under a minute each (one 40-second chunk starts the next), Sola's reporting API, Twilio REST.
 */

// Every second (Abraham, Nov 18, 2026)
export const WATCH_INTERVAL_MS = 1000;
export const WATCH_CHUNK_BUDGET_MS = 40_000;

/**
 * Hang-up timing (Abraham, Nov 18, 2026: never cut Sola off mid-sentence). The charge shows in Sola's report about when
 * Sola starts saying the result, so hanging up at once would cut it off.
 *  - Approved: Sola reads the reference number and hangs up by itself; we never hang up.
 *  - Declined: we wait while Sola says the result (Admin setting, seconds, measured on a test call), then hang up
 *    before Sola asks for a new amount.
 */
export function declineHangupMs(s: Record<string, unknown>): number {
  const x = Number(s.phonePayDeclineHangupSeconds);
  return Number.isFinite(x) && x >= 0 && x <= 15 ? Math.round(x * 1000) : 6000;
}
/** Not a hang-up timer: the watcher only stops looking after the longest possible call to Sola (15 minutes) has passed. */
export const WATCH_STOP_MS = 16 * 60_000;


/** Approved and declined Sola charges between two times (two read-only reports; SOLA_API_KEY stays on the server). */
export async function solaTransactionsBetween(from: Date, to: Date, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<SolaTxn[]> {
  const key = env.SOLA_API_KEY;
  if (!key) throw new Error("Not active yet: SOLA_API_KEY isn't in Vercel.");
  const et = (d: Date) => d.toLocaleString("sv-SE", { timeZone: "America/New_York" }).replace("T", " ");
  const one = async (command: "Report:Approved" | "Report:Declined") => {
    const res = await fetcher("https://x1.cardknox.com/reportjson", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ xKey: key, xVersion: "5.0.0", xSoftwareName: BUSINESS_NAME, xSoftwareVersion: "1.0", xCommand: command, xBeginDate: et(from), xEndDate: et(to) }),
    });
    const j = (await res.json().catch(() => ({}))) as { xResult?: string; xError?: string; xReportData?: Record<string, string>[] };
    if (j.xResult && j.xResult !== "S") throw new Error(`Sola report: ${j.xError || j.xResult}`);
    return (j.xReportData ?? []).map(
      (r): SolaTxn => ({
        refNum: String(r.xRefNum ?? ""),
        amountCents: Math.round(Number(r.xAmount ?? 0) * 100),
        at: easternToDate(String(r.xEnteredDate ?? "")),
        invoice: r.xInvoice ? String(r.xInvoice) : null,
        last4: (String(r.xMaskedCardNumber ?? "").match(/(\d{4})\s*$/) ?? [])[1] ?? null,
        cardType: r.xCardType ? String(r.xCardType) : null,
        approved: command === "Report:Approved",
      }),
    );
  };
  const [ok, no] = await Promise.all([one("Report:Approved"), one("Report:Declined")]);
  return [...ok, ...no];
}

export type WatchAttempt = { startedAt: Date; endedAt: Date | null; amountCents: number; result: string | null; solaSeen?: string | null; callerPhone?: string | null };

/**
 * One look while the call to Sola is up: "stop" (the caller is already back, the silence check hung up, or the call to
 * Sola cannot still be up), "approved" / "declined" (a charge of this try's amount since the try started), or "wait".
 * Never a time limit on the call itself (Abraham, Nov 18, 2026).
 */
export function watchDecision(a: WatchAttempt, txns: SolaTxn[], now: Date, used: Set<string> = new Set()): "stop" | "approved" | "declined" | "wait" {
  if (a.endedAt || a.result || a.solaSeen === "silence") return "stop";
  // Deep check 06:00 M38: a charge whose Invoice holds ANOTHER phone number is another caller's (two callers paying the
  // same amount at the same time), never this try's; one with no phone, or this caller's, still counts
  const phone = (a.callerPhone ?? "").replace(/\D/g, "").slice(-10);
  const otherCaller = (t: SolaTxn) => {
    const inv = (t.invoice ?? "").replace(/\D/g, "").slice(-10);
    return phone.length === 10 && inv.length === 10 && inv !== phone;
  };
  const mine = txns.filter((t) => t.refNum && !used.has(t.refNum) && t.amountCents === a.amountCents && isPhonePayInvoice(t.invoice) && !otherCaller(t) && t.at >= new Date(a.startedAt.getTime() - 60_000));
  if (mine.some((t) => t.approved)) return "approved";
  if (mine.length) return "declined";
  if (now.getTime() - a.startedAt.getTime() >= WATCH_STOP_MS) return "stop";
  return "wait";
}

/** Hang up the call to Sola: the separate call (with music), or the caller's own Dial leg (direct). */
export async function endSolaLeg(a: { callSid: string; payLegSid: string | null }) {
  if (a.payLegSid) await endMainPayLeg(a.payLegSid);
  try {
    const { getTwilio } = await import("@/lib/twilio-client");
    const c = getTwilio();
    if (!c) return;
    const kids = await c.calls.list({ parentCallSid: a.callSid, status: "in-progress", limit: 5 });
    for (const k of kids) await c.calls(k.sid).update({ status: "completed" }).catch(() => null);
  } catch {
    /* already over */
  }
}

/** Watch one try for up to `budgetMs`; true = still watching (start the next chunk). */
export async function runWatchChunk(
  attemptId: number,
  budgetMs = WATCH_CHUNK_BUDGET_MS,
  deps: { fetcher?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void>; end?: typeof endSolaLeg; declineWaitMs?: number; helper?: (attemptId: number) => Promise<boolean>; helperOn?: boolean } = {},
): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = now().getTime() + budgetMs;
  const { usedSolaRefs } = await import("@/lib/sola-phonepay");
  const { getSettings } = await import("@/lib/settings");
  const settings = await getSettings();
  const declineWait = deps.declineWaitMs ?? declineHangupMs(settings);
  const helperOn = deps.helperOn ?? settings.solaListenOn === true;
  while (now().getTime() < until) {
    const [a] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
    if (!a) return false;
    let txns: SolaTxn[] = [];
    try {
      txns = await solaTransactionsBetween(new Date(a.startedAt.getTime() - 60_000), new Date(now().getTime() + 60_000), deps.fetcher);
    } catch {
      /* Sola could not be checked this time: look again */
    }
    const d = watchDecision(a, txns, now(), await usedSolaRefs());
    if (d === "stop") return false;
    if (d !== "wait") {
      await db.update(schema.phonepayAttempts).set({ solaSeen: d }).where(eq(schema.phonepayAttempts.id, attemptId));
      // In the call log (Abraham, Nov 22, 2026: the retry check): what the watcher saw in Sola, and when
      const { track } = await import("@/lib/call-journey");
      await track(a.callSid, "step", `Payment watch: Sola shows ${d} (try ${a.tryNumber ?? "?"}); hanging up the Sola line`, { attempt: attemptId, solaSeen: d });
      // Option a: the helper hangs up about half a second after Sola stops talking (approved or declined)
      if (helperOn && (await (deps.helper ?? tellHelper)(attemptId))) {
        if (await helperHungUpWithin(attemptId, HELPER_GRACE_MS, now, sleep)) return false;
        console.error("[phonepay watch] the helper did not hang up in time; using the set seconds instead");
        if (d === "approved") return false; // Sola hangs up by itself after reading the reference number
        await (deps.end ?? endSolaLeg)({ callSid: a.callSid, payLegSid: a.payLegSid });
        return false;
      }
      // Option c (no helper, or it failed): Approved: Sola reads the reference number and hangs up by itself, so it is never cut off
      if (d === "approved") return false;
      // Declined: let Sola finish saying the result, then hang up before it asks for a new amount
      if (d === "declined") await sleep(declineWait);
      await (deps.end ?? endSolaLeg)({ callSid: a.callSid, payLegSid: a.payLegSid });
      await track(a.callSid, "step", `Payment watch: Sola line hung up after ${d} (try ${a.tryNumber ?? "?"})`, { attempt: attemptId });
      return false;
    }
    await sleep(WATCH_INTERVAL_MS);
  }
  const { track } = await import("@/lib/call-journey");
  const [still] = await db.select({ callSid: schema.phonepayAttempts.callSid, tryNumber: schema.phonepayAttempts.tryNumber }).from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
  if (still) await track(still.callSid, "step", `Payment watch: still waiting for Sola (try ${still.tryNumber ?? "?"}); nothing in Sola's record yet`, { attempt: attemptId });
  return true;
}

/* ---- Sola hang-up helper (Abraham, Nov 18, 2026, option a) ---- */

/** The helper on our free Cloudflare account (workers.dev address; no DNS). */
export const LISTEN_HOST = "hupup-sola-listen.hupup-attractions.workers.dev";
/** How long the watcher waits for the helper's hang-up before falling back to option c. */
export const HELPER_GRACE_MS = 15_000;
/** "About half a second" of no Sola voice = the end of Sola's sentence. */
export const HELPER_PAUSE_MS = 500;

export function silenceSeconds(s: Record<string, unknown>): number {
  const x = Math.floor(Number(s.phonePaySilenceSeconds));
  return x >= 5 && x <= 120 ? x : 20;
}

const signFor = (scope: string, attemptId: number) => createHmac("sha256", signingSecret()).update(`${scope}:${attemptId}`).digest("hex").slice(0, 32);
const same = (a: string, b: string | null) => Boolean(b) && a.length === (b ?? "").length && timingSafeEqual(Buffer.from(a), Buffer.from(b ?? ""));
/** Our signed addresses the helper calls: "hangup" (the result is in and Sola stopped talking) or "silence". */
export const helperUrl = (attemptId: number, what: "hangup" | "silence") => `${config.baseUrl()}/api/voice-watch/sola-listen?a=${attemptId}&do=${what}&s=${signFor(`sola-listen-${what}`, attemptId)}`;
export const verifyHelper = (attemptId: number, what: string, s: string | null) => (what === "hangup" || what === "silence") && attemptId > 0 && same(signFor(`sola-listen-${what}`, attemptId), s);

/**
 * The helper's key for one try (deep check Nov 27, item 18): HMAC-SHA256 of "sola-listen:<try>" with SOLA_LISTEN_KEY
 * (the same value as the Worker secret LISTEN_KEY). The Worker refuses any /stream or /result address without it.
 * Null when SOLA_LISTEN_KEY is not set (24+ characters): the helper is then not used and the watcher's own timing is
 * (option c), so a payment call is never left waiting on it.
 */
export function listenKey(attemptId: number, env: Record<string, string | undefined> = process.env): string | null {
  const k = env.SOLA_LISTEN_KEY;
  if (!k || k.length < 24) return null;
  return createHmac("sha256", k).update(`sola-listen:${attemptId}`).digest("hex").slice(0, 32);
}

/**
 * TwiML: send the audio of the call to Sola to the helper (Twilio Media Streams, about 1 cent per payment call,
 * approved by Abraham). `solaTrack`: "inbound" on our separate call to Sola (Sola is who answered), "outbound" on the
 * caller's own call (Sola's voice is what we send to the caller). Never recorded; the helper only measures loudness.
 */
export function startSolaListen(vr: { start: () => { stream: (a: Record<string, unknown>) => { parameter: (p: { name: string; value: string }) => unknown } } }, attemptId: number, solaTrack: "inbound" | "outbound", s: Record<string, unknown>) {
  // Without SOLA_LISTEN_KEY the Worker refuses the stream (Twilio only logs it; the call goes on) and the watcher's own
  // timing is used. The stream is still started so the later <Stop><Stream> by name always has one to stop.
  const stream = vr.start().stream({ url: `wss://${LISTEN_HOST}/stream/${attemptId}/${listenKey(attemptId) ?? "0".repeat(32)}`, track: "both_tracks", name: `sola-${attemptId}` });
  stream.parameter({ name: "hangup", value: helperUrl(attemptId, "hangup") });
  stream.parameter({ name: "silence", value: helperUrl(attemptId, "silence") });
  stream.parameter({ name: "solaTrack", value: solaTrack });
  stream.parameter({ name: "pauseMs", value: String(HELPER_PAUSE_MS) });
  stream.parameter({ name: "silenceSec", value: String(silenceSeconds(s)) });
}

/** Tell the helper Sola's record shows the result; true = it is listening to this call and will hang up. */
export async function tellHelper(attemptId: number, fetcher: typeof fetch = fetch, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const key = listenKey(attemptId, env);
  if (!key) return false; // no key: the helper can't be listening; the watcher's own timing is used
  try {
    const r = await fetcher(`https://${LISTEN_HOST}/result/${attemptId}/${key}`, { method: "POST", signal: AbortSignal.timeout(3000) });
    const j = (await r.json().catch(() => ({}))) as { listening?: boolean };
    return r.ok && j.listening === true;
  } catch {
    return false;
  }
}

async function helperHungUpWithin(attemptId: number, ms: number, now: () => Date, sleep: (ms: number) => Promise<void>): Promise<boolean> {
  const until = now().getTime() + ms;
  while (now().getTime() < until) {
    const [a] = await db.select({ h: schema.phonepayAttempts.helperEndedAt, e: schema.phonepayAttempts.endedAt }).from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
    if (!a || a.h || a.e) return true;
    await sleep(500);
  }
  return false;
}

/** The helper says: the result is in and Sola has stopped talking. Hang up only if Sola's record really shows a result. */
export async function helperHangup(attemptId: number, end: typeof endSolaLeg = endSolaLeg): Promise<{ hungUp: boolean }> {
  const [a] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
  if (!a || a.endedAt || a.helperEndedAt || !["approved", "declined"].includes(a.solaSeen ?? "")) return { hungUp: false };
  await db.update(schema.phonepayAttempts).set({ helperEndedAt: new Date() }).where(eq(schema.phonepayAttempts.id, attemptId));
  await end({ callSid: a.callSid, payLegSid: a.payLegSid });
  return { hungUp: true };
}

/**
 * Silence check (Abraham, Nov 18, 2026): no Sola voice, no key tones and no result for the set seconds. Check Sola's
 * record one more time: a result is used (the helper then hangs up at the end of Sola's sentence); still nothing = hang
 * up the call to Sola, and the caller hears box 147 ("Sorry, we could not confirm your payment. To try again, press 1.").
 */
export async function helperSilence(attemptId: number, deps: { fetcher?: typeof fetch; end?: typeof endSolaLeg; now?: Date } = {}): Promise<{ result: "approved" | "declined" | null }> {
  const [a] = await db.select().from(schema.phonepayAttempts).where(eq(schema.phonepayAttempts.id, attemptId)).limit(1);
  if (!a || a.endedAt || a.result || a.helperEndedAt) return { result: null };
  if (a.solaSeen === "approved" || a.solaSeen === "declined") return { result: a.solaSeen };
  const now = deps.now ?? new Date();
  let txns: SolaTxn[] = [];
  try {
    txns = await solaTransactionsBetween(new Date(a.startedAt.getTime() - 60_000), new Date(now.getTime() + 60_000), deps.fetcher);
  } catch {
    /* Sola could not be checked: no result (the payment check on our line looks again) */
  }
  const { usedSolaRefs } = await import("@/lib/sola-phonepay");
  const d = watchDecision(a, txns, now, await usedSolaRefs());
  if (d === "approved" || d === "declined") {
    await db.update(schema.phonepayAttempts).set({ solaSeen: d }).where(eq(schema.phonepayAttempts.id, attemptId));
    return { result: d };
  }
  await db.update(schema.phonepayAttempts).set({ solaSeen: "silence", helperEndedAt: new Date() }).where(eq(schema.phonepayAttempts.id, attemptId));
  await (deps.end ?? endSolaLeg)({ callSid: a.callSid, payLegSid: a.payLegSid });
  return { result: null };
}

/** The signed address of the watcher for one try (only our server can start it). */
const sign = (attemptId: number) => createHmac("sha256", signingSecret()).update(`phonepay-watch:${attemptId}`).digest("hex").slice(0, 32);
export const watchUrl = (attemptId: number) => `${config.baseUrl()}/api/voice-watch/phonepay?a=${attemptId}&s=${sign(attemptId)}`;
export function verifyWatch(attemptId: number, s: string | null): boolean {
  if (!attemptId || !s) return false;
  const want = Buffer.from(sign(attemptId));
  const got = Buffer.from(s);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Start the watcher for a try without delaying the caller (a quick request to our own watcher address). */
export async function startPayWatch(attemptId: number) {
  if (process.env.VITEST) return; // tests call runWatchChunk directly
  const kick = () => fetch(watchUrl(attemptId), { method: "POST" }).then(() => undefined).catch((e) => console.error("[phonepay watch] could not start", (e as Error).message));
  try {
    const { after } = await import("next/server");
    after(kick);
  } catch {
    await kick(); // outside a request (tests, scripts)
  }
}

/* ---- Limits (Admin settings) ---- */

export function phonePayLimits(s: Record<string, unknown>): { triesPerCall: number; declinesPerDay: number; callsPerDay: number } {
  const n = (v: unknown, d: number) => {
    const x = Math.floor(Number(v));
    return Number.isFinite(x) && x >= 1 && x <= 20 ? x : d;
  };
  return { triesPerCall: n(s.phonePayTriesPerCall, 3), declinesPerDay: n(s.phonePayDeclinesPerDay, 5), callsPerDay: n(s.phonePayCallsPerDay, 5) };
}

const NOT_PAID = ["declined", "wrong_amount_voided", "wrong_amount_not_voided"];

/** Card tries that did not go through from this phone in the last 24 hours. */
export async function declinesLast24h(phone: string, now = new Date()): Promise<number> {
  const rows = await db
    .select({ id: schema.phonepayAttempts.id })
    .from(schema.phonepayAttempts)
    .where(and(eq(schema.phonepayAttempts.callerPhone, phone), gte(schema.phonepayAttempts.startedAt, new Date(now.getTime() - 24 * 3600_000)), inArray(schema.phonepayAttempts.result, NOT_PAID)));
  return rows.length;
}

/**
 * Calls with card tries from this phone in the last 24 hours, not counting this call (Abraham, Nov 18, 2026: up to 5
 * calls with card tries per caller number in 24 hours, replacing 5 declines).
 */
export async function cardCallsLast24h(phone: string, exceptCallSid: string, now = new Date()): Promise<number> {
  const rows = await db
    .select({ callSid: schema.phonepayAttempts.callSid })
    .from(schema.phonepayAttempts)
    .where(and(eq(schema.phonepayAttempts.callerPhone, phone), gte(schema.phonepayAttempts.startedAt, new Date(now.getTime() - 24 * 3600_000))));
  return new Set(rows.map((r) => r.callSid).filter((c) => c !== exceptCallSid)).size;
}

/** A new call's first card try: block the number once it already had the limit of calls with card tries. */
export async function blockIfTooManyCalls(phone: string | null | undefined, callSid: string, limit: number, orderLabel: string, now = new Date()): Promise<boolean> {
  if (!phone) return false;
  if (await isPhonePayBlocked(phone)) return true;
  const n = await cardCallsLast24h(phone, callSid, now);
  if (n < limit) return false;
  await db.insert(schema.phonepayBlocks).values({ phone, declines: n });
  await emailBlocked(phone, `${n} calls with card payment tries in the last 24 hours (${orderLabel})`);
  return true;
}

async function emailBlocked(phone: string, why: string) {
  const to = config.adminEmail();
  if (!to) return;
  const { sendEmail } = await import("@/lib/notify");
  const { formatPhone } = await import("@/lib/phone");
  await sendEmail(
    to,
    `Hup Up Attractions: card payment by phone blocked for ${formatPhone(phone)}`,
    `${formatPhone(phone)} had ${why}. Card payment by phone is now blocked for this number; the caller is offered the payment link instead.\n\nThe secretary can unlock it here: ${config.baseUrl()}/admin/phone/card-blocks`,
  ).catch(() => null);
}

export async function isPhonePayBlocked(phone: string | null | undefined): Promise<boolean> {
  if (!phone) return false;
  const [b] = await db.select({ id: schema.phonepayBlocks.id }).from(schema.phonepayBlocks).where(and(eq(schema.phonepayBlocks.phone, phone), isNull(schema.phonepayBlocks.unlockedAt))).limit(1);
  return Boolean(b);
}

/** After a try that did not go through: block the number once it reaches the limit, and email the Owner. */
export async function blockIfTooManyDeclines(phone: string | null | undefined, limit: number, orderLabel: string, now = new Date()): Promise<boolean> {
  if (!phone) return false;
  if (await isPhonePayBlocked(phone)) return true;
  const n = await declinesLast24h(phone, now);
  if (n < limit) return false;
  await db.insert(schema.phonepayBlocks).values({ phone, declines: n });
  const to = config.adminEmail();
  if (to) {
    const { sendEmail } = await import("@/lib/notify");
    const { formatPhone } = await import("@/lib/phone");
    await sendEmail(
      to,
      `Hup Up Attractions: card payment by phone blocked for ${formatPhone(phone)}`,
      `${formatPhone(phone)} had ${n} card payments by phone that did not go through in the last 24 hours (${orderLabel}). Card payment by phone is now blocked for this number; the caller is offered the payment link instead.\n\nTo unlock it: ${config.baseUrl()}/admin/phone/card-blocks`,
    ).catch(() => null);
  }
  return true;
}

export async function blockedNumbers() {
  return db.select().from(schema.phonepayBlocks).where(isNull(schema.phonepayBlocks.unlockedAt)).orderBy(desc(schema.phonepayBlocks.blockedAt));
}

export async function unlockNumber(id: number, userId: number | null) {
  await db.update(schema.phonepayBlocks).set({ unlockedAt: new Date(), unlockedBy: userId }).where(and(eq(schema.phonepayBlocks.id, id), isNull(schema.phonepayBlocks.unlockedAt)));
}
