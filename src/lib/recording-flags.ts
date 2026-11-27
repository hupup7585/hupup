import { getSettings, saveSetting } from "@/lib/settings";
import { PROMPTS, type PromptKey } from "@/lib/ivr/prompts";
import { numberWords } from "@/lib/spoken-words";

/*
 * "Needs a new recording" (Abraham, Nov 27, 2026, 1:20 AM). Some recordings speak a value that is also an Admin
 * setting or a price (ocean ball prices, the payment-link hold minutes, hours, same-day delivery ranges). They stay
 * whole recordings. When that value is saved with a new amount, every linked recording slot is flagged, its text gets a
 * draft with the new value (waiting for Abraham), a red banner lists the slots, and the Owner gets one email per save.
 * The old recording keeps playing until a new one is uploaded and "Use this one" is pressed (that clears the flag);
 * changing the value back clears it too.
 */

/** A source is "setting:<key>" or "product:<category>:<size order>" (that item's price). */
export type RecordingLink = { source: string; label: string; slots: string[] };
export type RecordingFlag = { slot: string; source: string; label: string; from: string; to: string; at: string; fromRaw?: string };

const tenMinuteLines = () => (Object.entries(PROMPTS) as [PromptKey, { text: string }][]).filter(([, d]) => /\bten minutes\b/i.test(d.text)).map(([k]) => k);

/** Abraham's starting list (Nov 27, 2026); the Owner can change it on the Recordings page. */
export function defaultLinks(): RecordingLink[] {
  return [
    { source: "product:Ocean balls:1", label: "Price of 200 ocean balls", slots: ["ocean_200", "ocean_balls", "whole_ocean_200"] },
    { source: "product:Ocean balls:2", label: "Price of 500 ocean balls", slots: ["ocean_500", "ocean_balls"] },
    { source: "product:Ocean balls:3", label: "Price of 700 ocean balls", slots: ["ocean_700", "ocean_balls"] },
    { source: "setting:phoneLinkHoldMinutes", label: "Payment link hold on the phone (minutes)", slots: tenMinuteLines() },
    { source: "setting:hoursSchedules", label: "Customer service hours (Hours page)", slots: ["key7_cs_hours"] },
    { source: "setting:sameDayHoursClose", label: "Same-day delivery time close by (hours)", slots: ["same_day_notice_open", "same_day_notice_after"] },
    { source: "setting:sameDayHoursFar", label: "Same-day delivery time in the surrounding areas (hours)", slots: ["same_day_notice_open", "same_day_notice_after"] },
  ];
}

/** The links in use: the Owner's list (Recordings page), or the starting list. */
export function recordingLinks(s: { recordingLinks?: string | null }): RecordingLink[] {
  try {
    const own = JSON.parse(String(s.recordingLinks ?? "")) as RecordingLink[];
    if (Array.isArray(own) && own.length) return own.filter((l) => l && typeof l.source === "string" && Array.isArray(l.slots));
  } catch {
    // not set yet: the starting list
  }
  return defaultLinks();
}

export function recordingFlags(s: { recordingFlags?: string | null }): RecordingFlag[] {
  try {
    const f = JSON.parse(String(s.recordingFlags ?? "[]")) as RecordingFlag[];
    return Array.isArray(f) ? f : [];
  } catch {
    return [];
  }
}

/** The plain-English flag line for a slot. */
export function flagLine(f: RecordingFlag) {
  return `Needs a new recording: the setting ${f.label} changed from ${f.from} to ${f.to}`;
}

/** How a value is said inside a recording ("10" minutes -> "ten"; 1000 cents -> "$10"). */
function spokenForms(source: string, v: string): string[] {
  if (source.startsWith("product:")) {
    const cents = Number(v);
    const d = cents / 100;
    return Number.isFinite(cents) ? [`$${Number.isInteger(d) ? d : d.toFixed(2)}`] : [];
  }
  const n = Number(v);
  if (Number.isInteger(n) && n > 0 && n < 100) return [numberWords(n).join(" "), String(n)];
  return [];
}

/** Replaces a spoken value only as a whole word or amount ("ten" never inside "listen", "$10" never inside "$100"). */
export function replaceSpoken(text: string, oldWord: string, newWord: string): string {
  const esc = oldWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![A-Za-z0-9$])${esc}(?![A-Za-z0-9]|[.,]\\d)`, "g"), () => newWord);
}
export function hasSpoken(text: string, word: string) {
  return replaceSpoken(text, word, "\u0000") !== text;
}

/** The value as staff read it in the banner and email. */
function shown(source: string, v: string) {
  if (source.startsWith("product:")) return `$${(Number(v) / 100).toFixed(2)}`;
  return v.length > 60 ? "new hours" : v;
}

/**
 * A linked value was saved. Flags (or, when it is back to its old value, unflags) every linked slot, makes a draft of
 * the slot text with the new value when the old one is found in it, and emails the Owner once. Never throws.
 */
export async function linkedValueChanged(source: string, before: unknown, after: unknown, userId: number | null = null) {
  try {
    const from = String(before ?? "");
    const to = String(after ?? "");
    if (from === to) return;
    const s = (await getSettings()) as Record<string, unknown>;
    const links = recordingLinks(s as never).filter((l) => l.source === source);
    if (!links.length) return;
    let flags = recordingFlags(s as never);
    const now = new Date().toISOString();
    const touched: RecordingFlag[] = [];
    for (const link of links) {
      for (const slot of link.slots) {
        const old = flags.find((f) => f.slot === slot && f.source === source);
        if (old) {
          // Changed back to the value the recording says (raw values: two different hours lists both read "new hours")
          if (old.fromRaw !== undefined ? old.fromRaw === to : old.from === shown(source, to)) {
            flags = flags.filter((f) => f !== old); // changed back: the recording is right again
            await draftWithNewValue(slot, source, from, to, userId); // and its automatic draft is set aside
            continue;
          }
          old.to = shown(source, to);
          old.at = now;
          touched.push(old);
        } else {
          const f: RecordingFlag = { slot, source, label: link.label, from: shown(source, from), to: shown(source, to), at: now, fromRaw: from };
          flags.push(f);
          touched.push(f);
        }
        await draftWithNewValue(slot, source, from, to, userId);
      }
    }
    await saveSetting("recordingFlags" as never, JSON.stringify(flags) as never, userId, "Needs a new recording (automatic)");
    if (touched.length) await emailOwner(touched);
  } catch (e) {
    console.error("[recording flags]", source, e);
  }
}

/**
 * A draft of the slot's text with the new value, waiting for Abraham (only when the old value is in the text). It
 * starts from the open draft (another linked value may have changed in the same line, e.g. the ocean ball prices),
 * else from the wording live now (the Owner's own edits stay), never from the original wording in the code. When the
 * value goes back and the draft becomes the live wording again, the draft is set aside.
 */
async function draftWithNewValue(slot: string, source: string, from: string, to: string, userId: number | null) {
  if (!(slot in PROMPTS)) return;
  const { liveText, saveDraft, discardDraft } = await import("@/lib/prompt-versions");
  const { db, schema } = await import("@/lib/db");
  const { and, desc, eq } = await import("drizzle-orm");
  const [open] = await db
    .select()
    .from(schema.promptVersions)
    .where(and(eq(schema.promptVersions.promptKey, slot), eq(schema.promptVersions.status, "draft")))
    .orderBy(desc(schema.promptVersions.id))
    .limit(1);
  const live = await liveText(slot as PromptKey);
  const base = open?.text ?? live;
  const [oldWord] = spokenForms(source, from).filter((w) => hasSpoken(base, w));
  const [newWord] = spokenForms(source, to);
  if (!oldWord || !newWord) return;
  const next = replaceSpoken(base, oldWord, newWord);
  if (next === base) return;
  if (next.trim() === live.trim()) {
    if (open) await discardDraft(open.id, userId).catch(() => undefined);
    return;
  }
  await saveDraft(slot, next, userId).catch(() => undefined);
}

/** A new recording was put on the line ("Use this one"): its flag is cleared. */
export async function clearRecordingFlag(slot: string, userId: number | null = null) {
  const s = (await getSettings()) as Record<string, unknown>;
  const flags = recordingFlags(s as never);
  const left = flags.filter((f) => f.slot !== slot);
  if (left.length !== flags.length) await saveSetting("recordingFlags" as never, JSON.stringify(left) as never, userId, "New recording put on the line");
}

async function emailOwner(list: RecordingFlag[]) {
  const { config, LIVE_PUBLIC_EMAIL } = await import("@/lib/config");
  const to = config.adminEmail() || LIVE_PUBLIC_EMAIL;
  const { sendEmail } = await import("@/lib/notify");
  const lines = list.map((f) => `- ${f.slot}: ${flagLine(f)}.`);
  await sendEmail(
    to,
    "Hup Up Attractions: recordings need a new recording",
    [`A setting that is spoken inside some recordings was changed. These recording slots need a new recording:`, "", ...lines, "", "The old recording keeps playing until a new one is uploaded and \"Use this one\" is pressed.", `${config.baseUrl()}/admin/phone/prompts/slots`].join("\n"),
  ).catch((e) => console.error("[recording flags email]", e));
}
