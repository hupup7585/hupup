import { dayInfo, localISO, overrideFor, bookingLock, TIME_ZONE, type CalendarSettings } from "@/lib/jewish-calendar";
import { fixedFromISO } from "@/lib/hup-calendar/hebrew-date";
import { holidaysOn } from "@/lib/hup-calendar/holidays";

/**
 * Hours (Abraham, Nov 25, 2026, 4:54 and 4:56 PM): one place in Admin for every ringing line's hours and the website /
 * office hours. Each line has a weekly schedule (any number of time windows per day, or closed; Friday may end at
 * chatzos), Chanukah and Chol Hamoed rules (same as the weekday or their own windows), date overrides, and an on/off
 * switch. Lines can be put in a named group: one schedule and one switch for every line in it. Shabbes, Yom Tov,
 * Purim and Tisha B'Av are always closed; Admin's own closed days (Business hours & holidays) close every line too.
 * Stored in the setting `hoursSchedules` (JSON). Saving takes effect on the next call or page view; no deploy.
 */

export const LINE_IDS = ["cs", "problems", "delivery", "operator", "schools", "office"] as const;
export type LineId = (typeof LINE_IDS)[number];
export const LINE_LABEL: Record<LineId, string> = {
  cs: "Customer service (main menu key 3 and bookings menu key 0)",
  problems: "Problems during a rental (main menu key 4)",
  delivery: "Delivery and pickup (main menu key 5)",
  operator: "Operator (main menu key 0)",
  schools: "Schools and organizations (bookings menu key 9)",
  office: "Website and office hours (website hours, main menu key 7, office open or closed)",
};
/** Which schedule each ring line follows (ring key = the internal key used by the phone line). */
export const RING_KEY_LINE: Record<string, LineId> = { "4": "cs", "5": "problems", "6": "delivery", "0": "operator", "8": "schools", "2": "office" };

export type Win = { from: string; to: string }; // "HH:MM"; `to` may be "chatzos" (Friday)
export type Day = { closed: boolean; windows: Win[] };
export type HolidayRule = { same: boolean; windows: Win[] };
export type DateOverride = { from: string; to: string; closed: boolean; windows: Win[]; note?: string };
export type Schedule = { days: Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", Day>; chanukah: HolidayRule; cholHamoed: HolidayRule; overrides: DateOverride[] };
export type LineEntry = { schedule: Schedule; on: boolean };
export type Group = { id: string; name: string; members: LineId[]; schedule: Schedule; on: boolean };
export type HoursData = { lines: Record<LineId, LineEntry>; groups: Group[] };

type HoursInput = CalendarSettings & { hoursSchedules?: string; hoursMonThu?: string; hoursSunday?: string; hoursFridayOpen?: string; hoursCholHamoed?: string; hoursChanukah?: string };

const win = (r: string): Win[] => {
  const [from, to] = r.split("-");
  return from && to ? [{ from: from.trim(), to: to.trim() }] : [];
};
const open = (windows: Win[]): Day => ({ closed: windows.length === 0, windows });
const CLOSED: Day = { closed: true, windows: [] };

function week(sunThu: Win[], friday: Win[], sunday = sunThu): Schedule["days"] {
  return { "0": open(sunday), "1": open(sunThu), "2": open(sunThu), "3": open(sunThu), "4": open(sunThu), "5": open(friday), "6": CLOSED };
}

/** The values decided so far (Abraham, Nov 25, 2026): used until the Owner saves the Hours page. */
export function defaultHours(s: HoursInput): HoursData {
  const fri = [{ from: s.hoursFridayOpen || "10:30", to: "chatzos" }];
  const office: Schedule = {
    days: week(win(s.hoursMonThu || "10:30-19:00"), fri, win(s.hoursSunday || "11:30-19:00")),
    chanukah: { same: false, windows: win(s.hoursChanukah || "10:30-22:30") },
    cholHamoed: { same: false, windows: win(s.hoursCholHamoed || "10:30-22:30") },
    overrides: [],
  };
  const cs: Schedule = {
    days: week([{ from: "11:00", to: "14:00" }, { from: "19:30", to: "22:00" }], [{ from: "11:00", to: "chatzos" }]),
    chanukah: { same: true, windows: [] },
    cholHamoed: { same: true, windows: [] },
    overrides: [],
  };
  const staff = (): Schedule => ({
    days: week([{ from: "10:00", to: "19:00" }], fri),
    chanukah: { same: false, windows: [{ from: "09:00", to: "22:30" }] },
    cholHamoed: { same: false, windows: [{ from: "09:00", to: "22:30" }] },
    overrides: [],
  });
  const copy = (x: Schedule): Schedule => JSON.parse(JSON.stringify(x));
  return {
    lines: { cs: { schedule: cs, on: true }, problems: { schedule: staff(), on: true }, delivery: { schedule: staff(), on: true }, operator: { schedule: copy(office), on: true }, schools: { schedule: copy(office), on: true }, office: { schedule: office, on: true } },
    groups: [],
  };
}

/** The saved hours (or the defaults), checked so a bad value can never break the phone line. */
export function loadHours(s: HoursInput): HoursData {
  const def = defaultHours(s);
  let saved: Partial<HoursData> = {};
  try {
    saved = JSON.parse(s.hoursSchedules || "{}");
  } catch {
    saved = {};
  }
  const lines = { ...def.lines };
  for (const id of LINE_IDS) {
    const e = saved.lines?.[id];
    if (e && validSchedule(e.schedule)) lines[id] = { schedule: e.schedule, on: e.on !== false };
  }
  const seen = new Set<LineId>();
  const groups: Group[] = [];
  for (const g of saved.groups ?? []) {
    if (!g || !validSchedule(g.schedule)) continue;
    const members = (g.members ?? []).filter((m): m is LineId => (LINE_IDS as readonly string[]).includes(m) && !seen.has(m as LineId));
    members.forEach((m) => seen.add(m));
    if (members.length) groups.push({ id: String(g.id), name: String(g.name || "Group"), members, schedule: g.schedule, on: g.on !== false });
  }
  return { lines, groups };
}

function validSchedule(x: unknown): x is Schedule {
  const s = x as Schedule;
  return Boolean(s && s.days && ["0", "1", "2", "3", "4", "5", "6"].every((d) => s.days[d as "0"] && Array.isArray(s.days[d as "0"].windows)) && s.chanukah && s.cholHamoed && Array.isArray(s.overrides));
}

/** The schedule and switch a line follows: its group's when it is in one, else its own. */
export function effectiveLine(data: HoursData, id: LineId): LineEntry & { group: Group | null } {
  const g = data.groups.find((x) => x.members.includes(id)) ?? null;
  return g ? { schedule: g.schedule, on: g.on, group: g } : { ...data.lines[id], group: null };
}

const mins = (hhmm: string): number | null => {
  const r = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return r ? Number(r[1]) * 60 + Number(r[2]) : null;
};
function localMinutes(at: Date) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at).split(":").map(Number);
  return h * 60 + m;
}
const dow = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
const holidayKeys = (iso: string) => holidaysOn(fixedFromISO(iso)).map((e) => ({ key: e.key, flags: e.flags }));

/** Is a schedule open at this moment (Eastern time)? */
export function scheduleOpenNow(sch: Schedule, at: Date, s: CalendarSettings): boolean {
  const iso = localISO(at);
  const now = localMinutes(at);
  const info = dayInfo(iso, s);
  const inWindows = (ws: Win[]) =>
    ws.some((w) => {
      const from = mins(w.from);
      const chatzos = w.to.trim().toLowerCase() === "chatzos";
      const to = chatzos ? 24 * 60 : mins(w.to);
      if (from === null || to === null || now < from || now >= to) return false;
      if (chatzos && !info.closesAt) return false; // chatzos is only known on a day that closes early (Friday, Erev Yom Tov)
      return true;
    });
  const cutoff = () => !(info.closesAt && at >= info.closesAt); // never past the Erev close (chatzos or candle lighting)
  // Admin's own day (Business hours & holidays): closed closes every line; own hours apply to the office hours only
  const own = overrideFor(iso, s);
  if (own && !own.open) return false;
  // This schedule's own dates (a single day or a range)
  const o = sch.overrides.find((x) => x.from <= iso && iso <= (x.to || x.from));
  if (o) return !o.closed && inWindows(o.windows) && cutoff();
  const d = dow(iso);
  if (d === 6) {
    // Saturday night (Motzei Shabbes) windows only once Shabbes (and any Yom Tov) is over
    const sat = sch.days["6"];
    return !sat.closed && !bookingLock(at, s).locked && inWindows(sat.windows);
  }
  if (info.closed) return false; // Shabbes, Yom Tov
  const keys = holidayKeys(iso);
  if (!own?.open && keys.some((k) => k.key === "Purim" || k.key.startsWith("Tish'a B'Av"))) return false; // the Owner can open one (Business hours & holidays)
  const cholHamoed = keys.some((k) => k.flags.includes("CHOL_HAMOED"));
  const chanukah = d !== 5 && keys.some((k) => k.key.startsWith("Chanukah"));
  const rule = cholHamoed && d !== 5 ? sch.cholHamoed : chanukah ? sch.chanukah : null;
  const ws = rule && !rule.same ? rule.windows : sch.days[String(d) as "0"].closed ? [] : sch.days[String(d) as "0"].windows;
  return inWindows(ws) && cutoff();
}

/** Is this line open right now (its switch on and inside its hours)? */
export function lineOpen(data: HoursData, id: LineId, at: Date, s: CalendarSettings): boolean {
  const e = effectiveLine(data, id);
  return e.on && scheduleOpenNow(e.schedule, at, s);
}

/** Times in plain words: "11 AM", "7:30 PM", "Chatzos". */
export function timeWords(hhmm: string): string {
  if (hhmm.trim().toLowerCase() === "chatzos") return "Chatzos";
  const m = mins(hhmm);
  if (m === null) return hhmm;
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${((h + 11) % 12) + 1}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
}
const winWords = (ws: Win[]) => ws.map((w) => `${timeWords(w.from)}-${timeWords(w.to)}`).join(" and ");

/** Sunday to Thursday grouped where the hours are the same, then Friday (and Saturday night when open). */
function grouped(sch: Schedule, words: (d: Day) => string, names: string[], dash: string): [string, string][] {
  const out: [string, string][] = [];
  let i = 0;
  while (i < 5) {
    const w = words(sch.days[String(i) as "0"]);
    let j = i;
    while (j + 1 < 5 && words(sch.days[String(j + 1) as "0"]) === w) j++;
    if (w) out.push([j > i ? `${names[i]}${dash}${names[j]}` : names[i], w]);
    i = j + 1;
  }
  for (const d of [5, 6]) {
    const w = words(sch.days[String(d) as "0"]);
    if (w) out.push([names[d], w]);
  }
  return out;
}

/** A schedule in one line, e.g. "Sunday-Thursday 11 AM-2 PM and 7:30 PM-10 PM; Friday 11 AM-Chatzos". */
export function scheduleWords(sch: Schedule): string {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday night"];
  return grouped(sch, (d) => (d.closed ? "" : winWords(d.windows)), names, "-")
    .map(([day, w]) => `${day} ${w}`)
    .join("; ");
}

/** Website / office hours as "Day: hours" lines (the website Hours card and main menu key 7). */
export function officeLines(sch: Schedule): string[] {
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday night"];
  const words = (d: Day) => (d.closed ? "" : d.windows.map((w) => `${dashTime(w.from)} - ${dashTime(w.to)}`).join(", "));
  return grouped(sch, words, names, " - ").map(([day, w]) => `${day}: ${w}`);
}
/** "10:30 AM", "7:00 PM", "Chatzos" (the website's existing style). */
function dashTime(hhmm: string) {
  if (hhmm.trim().toLowerCase() === "chatzos") return "Chatzos";
  const m = mins(hhmm);
  if (m === null) return hhmm;
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Recorded hours lines that no longer match the saved hours (a red note on the Hours page). */
export function recordedHoursWarnings(data: HoursData): string[] {
  const out: string[] = [];
  const cs = effectiveLine(data, "cs").schedule;
  const fourPm = ["1", "2", "3", "4"].every((d) => JSON.stringify(cs.days[d as "1"].windows) === JSON.stringify([{ from: "11:00", to: "16:00" }]));
  if (!fourPm) out.push("The recorded hours line still says 11 AM to 4 PM. Ask for a new recording.");
  return out;
}

/* ---------- Admin: reading the Hours page form, groups ---------- */

/** "11:00-14:00, 19:30-22:00", "11 AM - 2 PM and 7:30 PM - 10 PM", "11:00-chatzos" or "Closed" -> windows (null = unclear). */
export function parseWindows(text: string, allowChatzos = false): Win[] | null {
  const t = text.trim();
  if (!t || /^closed$/i.test(t)) return [];
  const out: Win[] = [];
  for (const piece of t.split(/,|;|\band\b/i).map((x) => x.trim()).filter(Boolean)) {
    const ch = /^(.+?)\s*(?:-|–|—|to)\s*chatzos$/i.exec(piece);
    if (ch) {
      if (!allowChatzos) return null;
      const start = norm(`${ch[1]}-23:59`);
      if (!start) return null;
      out.push({ from: start.split("-")[0], to: "chatzos" });
      continue;
    }
    const r = norm(piece);
    if (!r) return null;
    const [from, to] = r.split("-");
    out.push({ from, to });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}
function norm(input: string): string | null {
  const parts = input.toLowerCase().replace(/\s+/g, "").replace(/–|—|to/g, "-").split("-").filter(Boolean);
  if (parts.length !== 2) return null;
  const toMin = (x: string): number | null => {
    const r = x.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
    if (!r) return null;
    let h = Number(r[1]);
    const m = Number(r[2] ?? 0);
    if (m > 59 || h > 23 || (r[3] && (h < 1 || h > 12))) return null;
    if (r[3] === "pm" && h !== 12) h += 12;
    if (r[3] === "am" && h === 12) h = 0;
    return h * 60 + m;
  };
  const a = toMin(parts[0]), b = toMin(parts[1]);
  if (a === null || b === null || b <= a) return null;
  const f = (x: number) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
  return `${f(a)}-${f(b)}`;
}
/** Windows back to the text the form shows. */
export const formatWindows = (ws: Win[]) => (ws.length ? ws.map((w) => `${w.from}-${w.to === "chatzos" ? "Chatzos" : w.to}`).join(", ") : "Closed");

/** Date overrides, one per line: "2026-12-24 closed Day off", "2026-12-24 to 2026-12-26 11:00-14:00 Busy week". */
export function parseDateOverrides(text: string): { list: DateOverride[]; error: string | null } {
  const list: DateOverride[] = [];
  for (const raw of text.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const r = /^(\d{4}-\d{2}-\d{2})(?:\s+(?:to|-)\s+(\d{4}-\d{2}-\d{2}))?\s+(closed|[0-9].*?)(?:\s+([A-Za-z].*))?$/i.exec(raw);
    if (!r) return { list, error: `This date line is not clear: "${raw}". Example: 2026-12-24 closed Day off` };
    const to = r[2] ?? r[1];
    if (to < r[1]) return { list, error: `The end date comes before the start date: "${raw}".` };
    if (/^closed$/i.test(r[3])) list.push({ from: r[1], to, closed: true, windows: [], note: r[4]?.trim() });
    else {
      const ws = parseWindows(r[3], true);
      if (!ws) return { list, error: `These hours are not clear: "${raw}". Example: 2026-12-24 11:00-14:00, 19:30-22:00` };
      list.push({ from: r[1], to, closed: false, windows: ws, note: r[4]?.trim() });
    }
  }
  return { list, error: null };
}
export const formatDateOverrides = (list: DateOverride[]) =>
  list.map((o) => [o.from, o.to !== o.from ? `to ${o.to}` : "", o.closed ? "closed" : formatWindows(o.windows), o.note ?? ""].filter(Boolean).join(" ")).join("\n");

const copySchedule = (x: Schedule): Schedule => JSON.parse(JSON.stringify(x));

/** Put lines in a new named group: one schedule (the first line's) and one switch. A line can be in one group only. */
export function addGroup(data: HoursData, name: string, members: LineId[]): HoursData | { error: string } {
  const clean = [...new Set(members)].filter((m) => (LINE_IDS as readonly string[]).includes(m));
  if (clean.length < 2) return { error: "Choose at least two lines for a group." };
  const taken = clean.find((m) => data.groups.some((g) => g.members.includes(m)));
  if (taken) return { error: `${LINE_LABEL[taken]} is already in a group. Take it out of that group first.` };
  const first = data.lines[clean[0]];
  const id = `g${Date.now().toString(36)}`;
  return { ...data, groups: [...data.groups, { id, name: name.trim() || "Group", members: clean, schedule: copySchedule(first.schedule), on: first.on }] };
}

/** Take a line out of its group: it keeps the group's current hours and switch as its own. */
export function removeFromGroup(data: HoursData, groupId: string, member: LineId): HoursData {
  const g = data.groups.find((x) => x.id === groupId);
  if (!g || !g.members.includes(member)) return data;
  const lines = { ...data.lines, [member]: { schedule: copySchedule(g.schedule), on: g.on } };
  const groups = data.groups.map((x) => (x.id === groupId ? { ...x, members: x.members.filter((m) => m !== member) } : x)).filter((x) => x.members.length > 0);
  return { lines, groups };
}

/** Save a schedule and switch for a line (or, when the line is in a group, for the whole group). */
export function setSchedule(data: HoursData, target: { line?: LineId; group?: string }, schedule: Schedule, on: boolean): HoursData {
  if (target.group) return { ...data, groups: data.groups.map((g) => (g.id === target.group ? { ...g, schedule, on } : g)) };
  if (target.line) {
    const g = data.groups.find((x) => x.members.includes(target.line!));
    if (g) return setSchedule(data, { group: g.id }, schedule, on);
    return { ...data, lines: { ...data.lines, [target.line]: { schedule, on } } };
  }
  return data;
}
