import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/**
 * Caller journeys (Abraham S): every menu and question a caller reached, every key pressed, what they said or typed,
 * items and categories heard or picked, dates asked about, unavailable items, where they hung up, and whether they
 * finished a booking. Logging never interrupts a call: failures are only written to the server log.
 *
 * Card numbers and security codes are never asked for on the hotline (payment is a texted secure link). As a
 * safeguard, any run of 7 or more digits that isn't a phone number field is replaced before saving, and runs of 13+
 * digits (card-length) are always replaced.
 */
export type JourneyKind =
  | "step"
  | "category_heard"
  | "item_heard"
  | "item_details"
  | "item_added"
  | "date_asked"
  | "date_closed"
  | "date_unclear"
  | "unavailable"
  | "typed"
  | "said"
  | "booking_finished"
  | "hung_up";

/** What each hotline step means, for the timeline. Steps not listed show their own name. */
export const STEP_LABELS: Record<string, string> = {
  incoming: "Call started",
  "record-start": "Recording notice played",
  menu: "Main menu",
  "menu-choice": "Main menu: key pressed",
  instructions: "Instructions menu (key 2)",
  learn: "Learn about our rentals (key 3)",
  "attraction-choice": "Picked an attraction",
  attraction: "Heard about an attraction",
  "attraction-options": "Attraction options",
  "attraction-after": "After the attraction: key pressed",
  book: "Booking menu (categories)",
  "book-choice": "Booking menu: key pressed",
  category: "Category menu",
  "category-choice": "Category menu: key pressed",
  product: "Item menu",
  "product-choice": "Item menu: key pressed",
  date: "Asked for the rental date",
  "date-heard": "Gave a date",
  "date-confirm": "Confirmed the date",
  qty: "Asked how many",
  "soldout-choice": "Sold out menu: key pressed",
  add: "Added to cart",
  "after-add": "After adding: key pressed",
  cart: "Shopping cart",
  "cart-choice": "Shopping cart: key pressed",
  ask: "Asked for details",
  type: "Switched to keypad typing",
  typed: "Typed on the keypad",
  heard: "Answered by voice",
  confirm: "Confirmed an answer",
  terms: "Rental terms",
  "terms-answer": "Rental terms: answer",
  phone: "Asked for a phone number",
  "phone-choice": "Phone number: key pressed",
  "phone-enter": "Entering a phone number",
  "phone-heard": "Gave a phone number",
  "phone-confirm": "Confirmed the phone number",
  "sms-consent": "Order texts question",
  "sms-consent-answer": "Order texts: answer",
  finalize: "Checkout",
  "promo-consent": "Promo texts question (Step 1)",
  "promo-consent-answer": "Promo texts: Step 1 answer",
  "promo-which": "Promo texts: which number (Step 2)",
  "promo-which-answer": "Promo texts: Step 2 answer",
  "promo-enter": "Promo texts: typing a number (Step 3)",
  "promo-heard": "Promo texts: number read back",
  "promo-confirm": "Promo texts: number confirmed",
  tz: "Time zone question",
  "tz-answer": "Time zone: answer",
  "tz-pick": "Time zone: picked",
  goodbye: "Goodbye",
  ring: "Ringing staff",
  hours: "Heard our hours (key 7)",
  operator: "Asked for a person",
  "operator-done": "Staff didn't answer",
  "voicemail-offer": "Offered voicemail",
  voicemail: "Voicemail",
  "voicemail-done": "Left a voicemail",
};

/** Steps that are Twilio callbacks, not something the caller did. */
export const NOT_CALLER_STEPS = new Set(["call-recording", "vm-recording", "vm-transcription", "whisper", "whisper-accept"]);

/** Fields where a phone number is expected (10-11 digits are fine there). */
const PHONE_STEPS = new Set(["phone-enter", "phone-heard", "phone-confirm"]);

export function redactDigits(s: string, allowPhone = false): string {
  return s.replace(/\d[\d\s-]{5,}\d/g, (m) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(m)) return m; // a date (YYYY-MM-DD), not a number to hide
    const n = m.replace(/\D/g, "").length;
    if (n >= 13) return "[number removed]";
    if (allowPhone && n <= 11) return m;
    return n >= 7 ? "[number removed]" : m;
  });
}

function clean(v: unknown, allowPhone: boolean): unknown {
  if (typeof v === "string") return redactDigits(v, allowPhone).slice(0, 500);
  if (Array.isArray(v)) return v.map((x) => clean(x, allowPhone));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, allowPhone)]));
  return v;
}

export async function track(callSid: string | null | undefined, kind: JourneyKind, label: string, detail: Record<string, unknown> = {}, step?: string) {
  if (!callSid) return;
  try {
    const allowPhone = !!step && PHONE_STEPS.has(step);
    await db.insert(schema.callEvents).values({ callSid, kind, label: redactDigits(label, allowPhone).slice(0, 300), detail: clean(detail, allowPhone) as Record<string, unknown>, step: step ?? null });
  } catch (e) {
    console.error("call journey log failed", kind, e);
  }
}

/** One webhook = one step: the menu or question reached, plus the key pressed or words said there. */
export async function trackStep(callSid: string, action: string, body: Record<string, string | undefined>, query: URLSearchParams) {
  if (NOT_CALLER_STEPS.has(action)) return;
  const detail: Record<string, unknown> = {};
  if (body.Digits) detail.key = body.Digits;
  if (body.SpeechResult) detail.said = body.SpeechResult;
  if (body.Confidence) detail.confidence = Number(body.Confidence);
  const q = Object.fromEntries(query.entries());
  if (Object.keys(q).length) detail.params = q;
  await track(callSid, "step", STEP_LABELS[action] ?? action, detail, action);
}

export type JourneyEvent = typeof schema.callEvents.$inferSelect;

export async function callJourney(callSid: string): Promise<JourneyEvent[]> {
  return db.select().from(schema.callEvents).where(eq(schema.callEvents.callSid, callSid)).orderBy(asc(schema.callEvents.id));
}

/** Journeys for many calls at once (the call log page). */
export async function callJourneys(callSids: string[]): Promise<Map<string, JourneyEvent[]>> {
  const out = new Map<string, JourneyEvent[]>();
  if (!callSids.length) return out;
  const rows = await db
    .select()
    .from(schema.callEvents)
    .where(sql`${schema.callEvents.callSid} IN (${sql.join(callSids.map((s) => sql`${s}`), sql`, `)})`)
    .orderBy(asc(schema.callEvents.id));
  for (const r of rows) out.set(r.callSid, [...(out.get(r.callSid) ?? []), r]);
  return out;
}

export type JourneyStats = {
  topItems: { name: string; heard: number; added: number }[];
  topDates: { date: string; calls: number }[];
  unavailable: { name: string; times: number }[];
  dropOff: { step: string; calls: number }[];
  finished: number;
};

const n = (v: unknown) => Number(v ?? 0) || 0;

/** Dashboard counts: most-requested items and dates, sold-out requests, and where callers hang up without booking. */
export async function journeyStats(days = 30, now = new Date()): Promise<JourneyStats> {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const until = now.toISOString();
  const w = sql`at >= ${since}::timestamptz AND at <= ${until}::timestamptz`;
  const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[];
  const items = await rows(sql`
    SELECT detail->>'item' AS name,
      count(DISTINCT call_sid) FILTER (WHERE kind = 'item_heard')::int AS heard,
      count(DISTINCT call_sid) FILTER (WHERE kind = 'item_added')::int AS added
    FROM call_events WHERE ${w} AND kind IN ('item_heard', 'item_added') AND detail ? 'item'
    GROUP BY 1 ORDER BY 2 DESC, 3 DESC, 1 LIMIT 10`);
  const dates = await rows(sql`
    SELECT detail->>'date' AS date, count(DISTINCT call_sid)::int AS calls
    FROM call_events WHERE ${w} AND kind = 'date_asked' AND detail ? 'date'
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`);
  const sold = await rows(sql`
    SELECT detail->>'item' AS name, count(*)::int AS times
    FROM call_events WHERE ${w} AND kind = 'unavailable' GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`);
  const drop = await rows(sql`
    SELECT coalesce(detail->>'lastStepLabel', 'Unknown') AS step, count(*)::int AS calls
    FROM call_events WHERE ${w} AND kind = 'hung_up' AND coalesce((detail->>'booked')::boolean, false) = false
    GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`);
  const [fin] = await rows(sql`SELECT count(DISTINCT call_sid)::int AS n FROM call_events WHERE ${w} AND kind = 'booking_finished'`);
  return {
    topItems: items.map((r) => ({ name: String(r.name), heard: n(r.heard), added: n(r.added) })),
    topDates: dates.map((r) => ({ date: String(r.date), calls: n(r.calls) })),
    unavailable: sold.map((r) => ({ name: String(r.name ?? "Unknown"), times: n(r.times) })),
    dropOff: drop.map((r) => ({ step: String(r.step), calls: n(r.calls) })),
    finished: n(fin?.n),
  };
}
