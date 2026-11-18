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
 *  - the call to Sola is also hung up after 4 minutes with no charge;
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
 *  - Approved: Sola reads the reference number and hangs up by itself; we never hang up (the 4-minute cap aside).
 *  - Declined: we wait while Sola says the result (Admin setting, seconds, measured on a test call), then hang up
 *    before Sola asks for a new amount.
 */
export function declineHangupMs(s: Record<string, unknown>): number {
  const x = Number(s.phonePayDeclineHangupSeconds);
  return Number.isFinite(x) && x >= 0 && x <= 15 ? Math.round(x * 1000) : 6000;
}
export const WATCH_LIMIT_MS = 4 * 60_000;


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

export type WatchAttempt = { startedAt: Date; endedAt: Date | null; amountCents: number; result: string | null };

/**
 * One look while the call to Sola is up: "stop" (the caller is already back), "timeout" (4 minutes, no charge),
 * "approved" / "declined" (a charge of this try's amount since the try started: hang up now), or "wait".
 */
export function watchDecision(a: WatchAttempt, txns: SolaTxn[], now: Date, used: Set<string> = new Set()): "stop" | "timeout" | "approved" | "declined" | "wait" {
  if (a.endedAt || a.result) return "stop";
  const mine = txns.filter((t) => t.refNum && !used.has(t.refNum) && t.amountCents === a.amountCents && isPhonePayInvoice(t.invoice) && t.at >= new Date(a.startedAt.getTime() - 60_000));
  if (mine.some((t) => t.approved)) return "approved";
  if (mine.length) return "declined";
  if (now.getTime() - a.startedAt.getTime() >= WATCH_LIMIT_MS) return "timeout";
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
  deps: { fetcher?: typeof fetch; now?: () => Date; sleep?: (ms: number) => Promise<void>; end?: typeof endSolaLeg; declineWaitMs?: number } = {},
): Promise<boolean> {
  const now = deps.now ?? (() => new Date());
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const until = now().getTime() + budgetMs;
  const { usedSolaRefs } = await import("@/lib/sola-phonepay");
  const { getSettings } = await import("@/lib/settings");
  const declineWait = deps.declineWaitMs ?? declineHangupMs(await getSettings());
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
      // Approved: Sola reads the reference number and hangs up by itself, so it is never cut off
      if (d === "approved") return false;
      // Declined: let Sola finish saying the result, then hang up before it asks for a new amount
      if (d === "declined") await sleep(declineWait);
      await (deps.end ?? endSolaLeg)({ callSid: a.callSid, payLegSid: a.payLegSid });
      return false;
    }
    await sleep(WATCH_INTERVAL_MS);
  }
  return true;
}

/** The signed address of the watcher for one try (only our server can start it). */
const sign = (attemptId: number) => createHmac("sha256", process.env.AUTH_SECRET || "dev-secret").update(`phonepay-watch:${attemptId}`).digest("hex").slice(0, 32);
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
