import type { TimerKey } from "@/lib/ivr/timers";
import type twilio from "twilio";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { PromptKey, PromptOverrides } from "./prompts";
import type { CallSession } from "./session";
import { callOutActive, vmAccessActive } from "@/lib/vm-access";
import { voicemailPlayLink } from "@/lib/signed-link";
import { fetchRecordingAudio, notifyVoicemail } from "@/lib/voicemail";
import { sendEmail } from "@/lib/notify";
import { BUSINESS_NAME } from "@/lib/config";
import { r2Delete, r2Get } from "@/lib/r2";
import { ensurePieces, pieceKey, r2AudioLink, saveRecordingToR2 } from "@/lib/vm-audio";
import {
  type Box,
  type Mode,
  type Msg,
  callerName,
  checkBoxPin,
  counts,
  eraseForever,
  eraseMsg,
  forwardToBox,
  getBox,
  getMsg,
  listMessages,
  logAction,
  otherBoxes,
  personalBoxForCaller,
  boxByNumber,
  restoreMsg,
  saveMsg,
  setAlerts,
  setBoxPin,
  sharedBoxes,
  staffEmails,
} from "@/lib/vm-boxes";

/**
 * Full voicemail by phone (Abraham, Nov 23, 2026), star 7 4 from the general voicemail (key 9). Like a carrier's
 * voicemail: personal boxes for the Owner and the Secretary (caller ID first, else the box number; then the box's own
 * password), new / saved / deleted messages, 5-second pieces (back, pause, forward), forward to a box or by email,
 * reply, send, greetings and personal options. Every action is logged for Admin Voicemail.
 */
type VR = InstanceType<typeof twilio.twiml.VoiceResponse>;
type Gather = ReturnType<VR["gather"]>;
type Ctx = { callSid: string; from: string | null; query: URLSearchParams; body: Record<string, string | undefined>; session: CallSession | null; prompts: PromptOverrides };
type Params = Record<string, string | number | undefined>;
export type VmHelpers = {
  sp: (t: VR | Gather, ctx: Ctx, key: PromptKey, vars?: Record<string, string | number>) => void;
  say: (t: VR | Gather, text: string) => void;
  back: (vr: VR, action: string, params?: Params) => VR;
  url: (action: string, params?: Params) => string;
  backLine: (g: Gather, ctx: Ctx) => void;
  when: (d: Date) => { date: string; time: string };
  update: (callSid: string, patch: { data: Record<string, unknown> }, s: CallSession | null) => Promise<unknown>;
  /** The Admin phone timers (Phone timing page; Hark's review item 5) */
  timer: (vr: VR, key: TimerKey) => number;
};
const digitsSpoken = (n: string) => {
  const d = n.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `${d.slice(0, 3).split("").join(" ")}, ${d.slice(3, 6).split("").join(" ")}, ${d.slice(6).split("").join(" ")}` : d.split("").join(" ");
};

export function makeVmHandlers(h: VmHelpers): Record<string, (ctx: Ctx, vr: VR) => Promise<VR> | VR> {
  const data = (ctx: Ctx) => (ctx.session?.data ?? {}) as Record<string, unknown>;
  const ownBox = (ctx: Ctx) => Number(data(ctx).vmMine) || 0;
  const signedIn = (ctx: Ctx) => vmAccessActive() && ownBox(ctx) > 0;
  const user = (ctx: Ctx) => (Number(data(ctx).vmMineUser) || null) as number | null;
  const keys = (vr: VR, action: string, params: Params = {}, opts: { finishOnKey?: string; numDigits?: number; timeout?: number } = {}) =>
    vr.gather({ input: ["dtmf"], numDigits: opts.numDigits ?? 1, timeout: opts.timeout ?? h.timer(vr, "timerVmNoKey"), finishOnKey: opts.finishOnKey ?? "", action: h.url(action, params), method: "POST" });
  /** No key for 5 seconds: the screen once more, then the main menu (Abraham, Nov 23, 2026). */
  const noKey = (vr: VR, ctx: Ctx, action: string, params: Params = {}) => (ctx.query.get("r") ? h.back(vr, signedIn(ctx) ? "vm-main" : "vm-bye", { s: 1 }) : h.back(vr, action, { ...params, r: 1 }));
  const wrong = (vr: VR, ctx: Ctx, action: string, params: Params = {}) => {
    h.sp(vr, ctx, "vm_not_valid");
    return h.back(vr, action, params);
  };
  const log = (ctx: Ctx, action: string, extra: { boxId?: number | null; voicemailId?: number | null; detail?: string | null } = {}) =>
    logAction({ boxId: extra.boxId ?? ownBox(ctx), voicemailId: extra.voicemailId ?? null, userId: user(ctx), action, detail: extra.detail ?? null, callSid: ctx.callSid });
  const boxMenu = (ctx: Ctx, b: number) => (b === ownBox(ctx) ? "vm-main" : "vm-sbox");
  const q = (ctx: Ctx, k: string) => ctx.query.get(k) ?? undefined;
  const num = (ctx: Ctx, k: string) => Number(ctx.query.get(k) || 0);

  /** "Message received Monday, November twenty-third, at 2:42 PM, from 8 4 5, 7 7 7, 7 5 8 5." (+ the name if known) */
  async function header(g: VR | Gather, ctx: Ctx, v: Msg) {
    const w = h.when(v.createdAt);
    let from = "a withheld number";
    if (v.fromBoxId && !v.audioOf && !v.fromNumber) from = (await getBox(v.fromBoxId))?.name ?? "a voicemail box";
    else if (v.fromNumber) {
      const name = await callerName(v.fromNumber);
      from = `${name ? `${name}, ` : ""}${digitsSpoken(v.fromNumber)}`;
    }
    h.sp(g, ctx, "vm_header", { date: w.date, time: w.time, from });
  }

  async function next(vr: VR, ctx: Ctx, b: number, m: Mode, after: number) {
    const list = await listMessages(b, m);
    const n = list.find((x) => x.id > after);
    if (n) return h.back(vr, "vm-msg", { b, m, v: n.id });
    h.sp(vr, ctx, "vm_no_more");
    return h.back(vr, boxMenu(ctx, b), { b, s: 1 });
  }

  function boxList(g: Gather, ctx: Ctx, boxes: Box[]) {
    boxes.forEach((x, i) => {
      if (x.nameKey) {
        h.say(g, "For");
        g.play(r2AudioLink(x.nameKey));
        h.say(g, `press ${i + 1}.`);
      } else h.sp(g, ctx, "vm_for_key", { name: x.name, key: i + 1 });
    });
    h.backLine(g, ctx);
  }

  async function startRecording(vr: VR, ctx: Ctx, prompt: PromptKey, done: string, params: Params, maxLength = h.timer(vr, "timerVmGreetingMax")) {
    h.sp(vr, ctx, prompt);
    vr.record({ action: h.url(done, params), method: "POST", maxLength, playBeep: true, finishOnKey: "#", trim: "trim-silence" });
    return vr;
  }

  return {
    // ---- sign in ----
    async "vm-start"(ctx, vr) {
      if (!vmAccessActive()) return h.back(vr, "menu");
      const box = await personalBoxForCaller(ctx.session?.fromNumber ?? ctx.from);
      return box ? h.back(vr, "vm-pass", { b: box.id }) : h.back(vr, "vm-num");
    },
    "vm-num"(ctx, vr) {
      const g = keys(vr, "vm-num-heard", {}, { numDigits: 6, finishOnKey: "#" });
      h.sp(g, ctx, "vm_box_number");
      return noKey(vr, ctx, "vm-num");
    },
    async "vm-num-heard"(ctx, vr) {
      const box = await boxByNumber((ctx.body.Digits ?? "").replace(/\D/g, ""));
      if (!box) return wrong(vr, ctx, "vm-num");
      return h.back(vr, "vm-pass", { b: box.id });
    },
    async "vm-pass"(ctx, vr) {
      const box = await getBox(num(ctx, "b"));
      if (!box) return h.back(vr, "vm-num");
      if (box.lockedUntil && box.lockedUntil > new Date()) {
        h.sp(vr, ctx, "vma_locked");
        vr.hangup();
        return vr;
      }
      const g = keys(vr, "vm-pass-heard", { b: box.id }, { numDigits: 9, finishOnKey: "#" });
      h.sp(g, ctx, "vm_password");
      return noKey(vr, ctx, "vm-pass", { b: box.id });
    },
    async "vm-pass-heard"(ctx, vr) {
      const box = await getBox(num(ctx, "b"));
      if (!box) return h.back(vr, "vm-num");
      const r = await checkBoxPin(box, (ctx.body.Digits ?? "").replace(/\D/g, ""));
      if (r === "ok") {
        await h.update(ctx.callSid, { data: { vmMine: box.id, vmMineUser: box.ownerUserId, vmaOk: 1, vmHint: undefined } }, ctx.session);
        if (ctx.session) Object.assign(ctx.session.data, { vmMine: box.id, vmMineUser: box.ownerUserId, vmaOk: 1 });
        await logAction({ boxId: box.id, userId: box.ownerUserId, action: "Signed in by phone", callSid: ctx.callSid });
        return h.back(vr, "vm-main");
      }
      await logAction({ boxId: box.id, userId: box.ownerUserId, action: r === "locked" ? "Locked after 3 wrong passwords" : "Wrong password", callSid: ctx.callSid });
      if (r === "locked") {
        h.sp(vr, ctx, "vma_locked");
        vr.hangup();
        return vr;
      }
      h.sp(vr, ctx, "vm_password_wrong");
      return h.back(vr, "vm-pass", { b: box.id });
    },
    "vm-bye"(ctx, vr) {
      h.sp(vr, ctx, "vm_goodbye");
      vr.hangup();
      return vr;
    },

    // ---- main menu ----
    async "vm-main"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const b = ownBox(ctx);
      const g = keys(vr, "vm-main-key");
      if (!ctx.query.get("s") && !ctx.query.get("r")) {
        const c = await counts(b);
        h.sp(g, ctx, "vm_counts", { new: c.new, saved: c.saved });
      }
      h.sp(g, ctx, "vm_main");
      h.sp(g, ctx, "vm_shared_key");
      if (ctx.query.get("r")) return h.back(vr, "vm-bye"); // no key twice on the main menu: goodbye
      return h.back(vr, "vm-main", { s: 1, r: 1 });
    },
    async "vm-main-key"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const b = ownBox(ctx);
      const d = ctx.body.Digits ?? "";
      if (d === "1") return h.back(vr, "vm-list", { b, m: "new" });
      if (d === "2") return h.back(vr, "vm-send");
      if (d === "3") return h.back(vr, "vm-list", { b, m: "saved" });
      if (d === "4") return h.back(vr, "vm-greet");
      if (d === "5") return h.back(vr, "vm-opts");
      if (d === "6") return h.back(vr, "vm-list", { b, m: "deleted" });
      if (d === "8") return h.back(vr, "vm-shared");
      if (d === "*") return h.back(vr, "vm-bye");
      // Owner only, not announced: the custom charge (Nov 14, 2026); calling out stays off until approved
      if (d === "7" && (await getBox(b))?.ownerUserId && (await db.select({ role: schema.adminUsers.role }).from(schema.adminUsers).where(eq(schema.adminUsers.id, user(ctx) ?? 0)).limit(1))[0]?.role === "owner") return h.back(vr, "vma-charge");
      if (d === "0" && callOutActive()) return h.back(vr, "vma-out");
      return wrong(vr, ctx, "vm-main", { s: 1 });
    },

    // ---- shared boxes ----
    async "vm-shared"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const g = keys(vr, "vm-shared-key");
      boxList(g, ctx, await sharedBoxes());
      return noKey(vr, ctx, "vm-shared");
    },
    async "vm-shared-key"(ctx, vr) {
      const d = ctx.body.Digits ?? "";
      if (d === "*") return h.back(vr, "vm-main", { s: 1 });
      const box = (await sharedBoxes())[Number(d) - 1];
      if (!box) return wrong(vr, ctx, "vm-shared");
      return h.back(vr, "vm-sbox", { b: box.id });
    },
    async "vm-sbox"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const b = num(ctx, "b");
      const g = keys(vr, "vm-sbox-key", { b });
      if (!ctx.query.get("s") && !ctx.query.get("r")) {
        const c = await counts(b);
        h.sp(g, ctx, "vm_counts", { new: c.new, saved: c.saved });
      }
      h.sp(g, ctx, "vm_shared_menu");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-sbox", { b, s: 1 });
    },
    "vm-sbox-key"(ctx, vr) {
      const b = num(ctx, "b");
      const d = ctx.body.Digits ?? "";
      if (d === "1") return h.back(vr, "vm-list", { b, m: "new" });
      if (d === "3") return h.back(vr, "vm-list", { b, m: "saved" });
      if (d === "6") return h.back(vr, "vm-list", { b, m: "deleted" });
      if (d === "*") return h.back(vr, "vm-shared");
      return wrong(vr, ctx, "vm-sbox", { b, s: 1 });
    },

    // ---- messages ----
    async "vm-list"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const b = num(ctx, "b");
      const m = (q(ctx, "m") ?? "new") as Mode;
      const list = await listMessages(b, m);
      if (m === "deleted") h.sp(vr, ctx, "vm_deleted_count", { count: list.length });
      if (!list.length) {
        if (m !== "deleted") h.sp(vr, ctx, "vm_no_more");
        return h.back(vr, boxMenu(ctx, b), { b, s: 1 });
      }
      return h.back(vr, "vm-msg", { b, m, v: list[0].id });
    },
    async "vm-msg"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const b = num(ctx, "b");
      const m = q(ctx, "m") ?? "new";
      const v = await getMsg(num(ctx, "v"));
      if (!v) return next(vr, ctx, b, m as Mode, num(ctx, "v"));
      await header(vr, ctx, v);
      if (!data(ctx).vmHint && m !== "deleted") {
        h.sp(vr, ctx, "vm_during");
        await h.update(ctx.callSid, { data: { vmHint: 1 } }, ctx.session);
      }
      if (v.noteKey) vr.play(r2AudioLink(v.noteKey));
      await log(ctx, "Listened", { boxId: b, voicemailId: v.id });
      return h.back(vr, "vm-piece", { b, m, v: v.id, p: 0 });
    },
    /** One 5-second piece; a key during it acts at once (the whole message when there are no pieces). */
    async "vm-piece"(ctx, vr) {
      const b = num(ctx, "b");
      const m = q(ctx, "m");
      const v = await getMsg(num(ctx, "v"));
      if (!v) return h.back(vr, "vm-list", { b, m });
      const total = await ensurePieces(v);
      const p = num(ctx, "p");
      const g = keys(vr, "vm-pkey", { b, m, v: v.id, p, n: total }, { timeout: h.timer(vr, "timerVmPlaybackKey") });
      if (total > 0) {
        if (p >= total) return h.back(vr, "vm-after", { b, m, v: v.id });
        g.play(r2AudioLink(pieceKey(v.audioOf ?? v.id, p)));
        return h.back(vr, total > p + 1 ? "vm-piece" : "vm-after", total > p + 1 ? { b, m, v: v.id, p: p + 1 } : { b, m, v: v.id });
      }
      g.play(voicemailPlayLink(v.id, 1));
      return h.back(vr, "vm-after", { b, m, v: v.id });
    },
    async "vm-pkey"(ctx, vr) {
      const b = num(ctx, "b");
      const m = (q(ctx, "m") ?? "new") as Mode;
      const vId = num(ctx, "v");
      const p = num(ctx, "p");
      const total = num(ctx, "n");
      const d = ctx.body.Digits ?? "";
      const at = (piece: number) => h.back(vr, "vm-piece", { b, m, v: vId, p: Math.max(0, piece) });
      if (d === "1") return at(total ? p - 1 : 0);
      if (d === "3") return total && p + 1 < total ? at(p + 1) : h.back(vr, "vm-after", { b, m, v: vId });
      if (d === "2") return h.back(vr, "vm-pause", { b, m, v: vId, p });
      if (d === "#") return h.back(vr, "vm-after", { b, m, v: vId });
      if (d === "5") {
        const v = await getMsg(vId);
        if (v) await header(vr, ctx, v);
        return at(p);
      }
      if (m !== "deleted" && (d === "7" || d === "9")) return h.back(vr, "vm-act", { b, m, v: vId, k: d });
      h.sp(vr, ctx, "vm_not_valid");
      return at(p);
    },
    "vm-pause"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), p: q(ctx, "p") };
      const g = keys(vr, "vm-pause-key", pr, { timeout: h.timer(vr, "timerVmPauseKey") });
      h.sp(g, ctx, "vm_paused");
      return noKey(vr, ctx, "vm-pause", pr);
    },
    "vm-pause-key"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), p: q(ctx, "p") };
      if (ctx.body.Digits === "2") return h.back(vr, "vm-piece", pr);
      return wrong(vr, ctx, "vm-pause", pr);
    },
    "vm-after"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v") };
      const g = keys(vr, "vm-act", pr);
      h.sp(g, ctx, pr.m === "deleted" ? "vm_deleted_after" : "vm_after");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-after", pr);
    },
    async "vm-act"(ctx, vr) {
      const b = num(ctx, "b");
      const m = (q(ctx, "m") ?? "new") as Mode;
      const vId = num(ctx, "v");
      const d = ctx.query.get("k") ?? ctx.body.Digits ?? "";
      const pr = { b, m, v: vId };
      if (d === "*") return h.back(vr, boxMenu(ctx, b), { b, s: 1 });
      if (m === "deleted") {
        if (d === "9") {
          await restoreMsg(vId);
          await log(ctx, "Restored to saved", { boxId: b, voicemailId: vId });
          h.sp(vr, ctx, "vm_restored");
          return next(vr, ctx, b, m, vId);
        }
        if (d === "7") return h.back(vr, "vm-erase", pr);
        if (d === "#") return next(vr, ctx, b, m, vId);
        return wrong(vr, ctx, "vm-after", pr);
      }
      if (d === "4") return h.back(vr, "vm-piece", { ...pr, p: 0 });
      if (d === "5") {
        const v = await getMsg(vId);
        if (v) await header(vr, ctx, v);
        return h.back(vr, "vm-after", pr);
      }
      if (d === "6") return h.back(vr, "vm-fwd", pr);
      if (d === "7") {
        await eraseMsg(vId);
        await log(ctx, "Erased (kept 30 days in deleted messages)", { boxId: b, voicemailId: vId });
        h.sp(vr, ctx, "vm_msg_erased");
        return next(vr, ctx, b, m, vId);
      }
      if (d === "8") return h.back(vr, "vm-reply", pr);
      if (d === "9") {
        await saveMsg(vId);
        await log(ctx, "Saved", { boxId: b, voicemailId: vId });
        h.sp(vr, ctx, "vm_msg_saved");
        return next(vr, ctx, b, m, vId);
      }
      if (d === "#") {
        if (m === "new") h.sp(vr, ctx, "vm_msg_kept");
        return next(vr, ctx, b, m, vId);
      }
      return wrong(vr, ctx, "vm-after", pr);
    },
    "vm-erase"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v") };
      const g = keys(vr, "vm-erase-key", pr);
      h.sp(g, ctx, "vm_erase_confirm");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-erase", pr);
    },
    async "vm-erase-key"(ctx, vr) {
      const b = num(ctx, "b");
      const vId = num(ctx, "v");
      if (ctx.body.Digits === "7") {
        await eraseForever(vId);
        await log(ctx, "Erased forever", { boxId: b, voicemailId: vId });
        h.sp(vr, ctx, "vm_erased_forever");
        return next(vr, ctx, b, "deleted", vId);
      }
      if (ctx.body.Digits === "*") return h.back(vr, "vm-after", { b, m: "deleted", v: vId });
      return wrong(vr, ctx, "vm-erase", { b, m: "deleted", v: vId });
    },

    // ---- forward ----
    "vm-fwd"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v") };
      const g = keys(vr, "vm-fwd-key", pr);
      h.sp(g, ctx, "vm_fwd_menu");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-fwd", pr);
    },
    "vm-fwd-key"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v") };
      const d = ctx.body.Digits;
      if (d === "1") return h.back(vr, "vm-fwd-list", { ...pr, t: "box" });
      if (d === "2") return h.back(vr, "vm-fwd-list", { ...pr, t: "mail" });
      if (d === "*") return h.back(vr, "vm-after", pr);
      return wrong(vr, ctx, "vm-fwd", pr);
    },
    async "vm-fwd-list"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), t: q(ctx, "t") };
      // no box (an old or broken link, Hark's review M9): back to the voicemail main menu, not "something went wrong"
      if (!Number(pr.b)) return h.back(vr, signedIn(ctx) ? "vm-main" : "vm-bye", { s: 1 });
      const g = keys(vr, "vm-fwd-pick", pr);
      if (pr.t === "mail") {
        (await staffEmails()).forEach((s, i) => h.sp(g, ctx, "vm_for_key", { name: s.name, key: i + 1 }));
        h.backLine(g, ctx);
      } else boxList(g, ctx, await otherBoxes(Number(pr.b)));
      return noKey(vr, ctx, "vm-fwd-list", pr);
    },
    async "vm-fwd-pick"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), t: q(ctx, "t") };
      if (!Number(pr.b)) return h.back(vr, signedIn(ctx) ? "vm-main" : "vm-bye", { s: 1 });
      const d = ctx.body.Digits ?? "";
      if (d === "*") return h.back(vr, "vm-fwd", pr);
      const i = Number(d) - 1;
      const to = pr.t === "mail" ? (await staffEmails())[i]?.id : (await otherBoxes(Number(pr.b)))[i]?.id;
      if (!to) return wrong(vr, ctx, "vm-fwd-list", pr);
      return h.back(vr, "vm-note", { ...pr, to });
    },
    "vm-note"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), t: q(ctx, "t"), to: q(ctx, "to") };
      const g = keys(vr, "vm-note-key", pr, { timeout: h.timer(vr, "timerVmNoteKey") });
      h.sp(g, ctx, "vm_note_offer");
      return h.back(vr, "vm-fwd-do", pr); // stay on the line: no note
    },
    "vm-note-key"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), t: q(ctx, "t"), to: q(ctx, "to") };
      if (ctx.body.Digits === "1") return startRecording(vr, ctx, "vm_note_record", "vm-note-done", pr, 120);
      return h.back(vr, "vm-fwd-do", pr);
    },
    async "vm-note-done"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), t: q(ctx, "t"), to: q(ctx, "to") };
      const key = `voicemail/note/${ctx.callSid}-${Date.now()}.wav`;
      const ok = ctx.body.RecordingUrl ? await saveRecordingToR2(ctx.body.RecordingUrl, key).catch(() => false) : false;
      return h.back(vr, "vm-fwd-do", { ...pr, n: ok ? key : undefined });
    },
    async "vm-fwd-do"(ctx, vr) {
      const b = num(ctx, "b");
      const pr = { b, m: q(ctx, "m"), v: q(ctx, "v") };
      const v = await getMsg(num(ctx, "v"));
      const to = num(ctx, "to");
      const note = q(ctx, "n") ?? null;
      if (!v || !to) return h.back(vr, "vm-after", pr);
      if (ctx.query.get("t") === "mail") {
        const staff = (await staffEmails()).find((s) => s.id === to);
        if (staff) {
          const audioSrc = v.audioOf ? ((await getMsg(v.audioOf)) ?? v) : v;
          const audio = await fetchRecordingAudio(audioSrc);
          const att = audio ? [{ filename: `voicemail-${v.id}.mp3`, content: Buffer.from(await audio.arrayBuffer()) }] : [];
          if (note) {
            const n = await r2Get(note).catch(() => null);
            if (n?.ok) att.unshift({ filename: "note.wav", content: Buffer.from(await n.arrayBuffer()) });
          }
          const w = h.when(v.createdAt);
          await sendEmail(staff.email, `${BUSINESS_NAME}: forwarded voicemail`, [`A voicemail was forwarded to you by phone.`, "", `Received: ${w.date}, at ${w.time}`, `From: ${v.fromNumber ?? "a withheld number"}`, note ? "A recorded note is attached first." : ""].filter(Boolean).join("\n"), att as never);
          await log(ctx, `Forwarded by email to ${staff.name}`, { boxId: b, voicemailId: v.id });
          if (note) await r2Delete(note).catch(() => null);
        }
      } else {
        const id = await forwardToBox(v, to, ownBox(ctx), note);
        await notifyVoicemail(id).catch(() => null);
        await log(ctx, `Forwarded to the box ${(await getBox(to))?.name ?? to}`, { boxId: b, voicemailId: v.id });
      }
      h.sp(vr, ctx, "vm_forwarded");
      return h.back(vr, "vm-after", pr);
    },

    // ---- reply ----
    "vm-reply"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v") };
      const g = keys(vr, "vm-reply-key", pr);
      h.sp(g, ctx, "vm_reply_menu");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-reply", pr);
    },
    async "vm-reply-key"(ctx, vr) {
      const pr = { b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v") };
      const d = ctx.body.Digits;
      if (d === "*") return h.back(vr, "vm-after", pr);
      if (d === "2") {
        h.sp(vr, ctx, "vm_callback_off"); // calling back stays off until Abraham approves the call-out price
        return h.back(vr, "vm-after", pr);
      }
      if (d === "1") {
        const v = await getMsg(Number(pr.v));
        if (!v?.fromBoxId) {
          h.sp(vr, ctx, "vm_reply_none");
          return h.back(vr, "vm-after", pr);
        }
        return startRecording(vr, ctx, "vm_record_msg", "vm-rec-done", { to: v.fromBoxId, k: "reply", ...pr });
      }
      return wrong(vr, ctx, "vm-reply", pr);
    },

    // ---- send ----
    async "vm-send"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const g = keys(vr, "vm-send-key");
      h.sp(g, ctx, "vm_choose_box");
      boxList(g, ctx, await otherBoxes(ownBox(ctx)));
      return noKey(vr, ctx, "vm-send");
    },
    async "vm-send-key"(ctx, vr) {
      const d = ctx.body.Digits ?? "";
      if (d === "*") return h.back(vr, "vm-main", { s: 1 });
      const box = (await otherBoxes(ownBox(ctx)))[Number(d) - 1];
      if (!box) return wrong(vr, ctx, "vm-send");
      if (box.greetingKey) vr.play(r2AudioLink(box.greetingKey)); // that person's greeting first
      return startRecording(vr, ctx, "vm_record_msg", "vm-rec-done", { to: box.id, k: "send" });
    },
    async "vm-rec-done"(ctx, vr) {
      const pr = { to: q(ctx, "to"), k: q(ctx, "k"), b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v") };
      if (!ctx.body.RecordingUrl || !ctx.body.RecordingSid) return h.back(vr, pr.k === "reply" ? "vm-after" : "vm-main", pr.k === "reply" ? pr : { s: 1 });
      const [row] = await db
        .insert(schema.voicemails)
        .values({ boxId: Number(pr.to), callSid: ctx.callSid, fromNumber: null, recordingSid: ctx.body.RecordingSid, recordingUrl: ctx.body.RecordingUrl, durationSec: Number(ctx.body.RecordingDuration || 0), transcriptionStatus: "off", state: "reviewing", fromBoxId: ownBox(ctx) })
        .onConflictDoNothing({ target: schema.voicemails.recordingSid })
        .returning();
      // Extra check I3 (Nov 27, 2026): a repeated Twilio callback for the same recording finds the saved message
      const id = row?.id ?? (await db.select({ id: schema.voicemails.id }).from(schema.voicemails).where(eq(schema.voicemails.recordingSid, ctx.body.RecordingSid)).limit(1))[0]?.id;
      return h.back(vr, "vm-rec-review", { ...pr, id });
    },
    "vm-rec-review"(ctx, vr) {
      const pr = { to: q(ctx, "to"), k: q(ctx, "k"), b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), id: q(ctx, "id") };
      const g = keys(vr, "vm-rec-key", pr);
      h.sp(g, ctx, "vm_send_review");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-rec-review", pr);
    },
    async "vm-rec-key"(ctx, vr) {
      const pr = { to: q(ctx, "to"), k: q(ctx, "k"), b: q(ctx, "b"), m: q(ctx, "m"), v: q(ctx, "v"), id: q(ctx, "id") };
      const id = Number(pr.id);
      const d = ctx.body.Digits;
      const done = () => (pr.k === "reply" ? h.back(vr, "vm-after", { b: pr.b, m: pr.m, v: pr.v }) : h.back(vr, "vm-main", { s: 1 }));
      if (d === "1" && id) {
        await db.update(schema.voicemails).set({ state: "submitted" }).where(eq(schema.voicemails.id, id));
        await notifyVoicemail(id).catch(() => null);
        await log(ctx, pr.k === "reply" ? "Replied with a voice message" : `Sent a message to ${(await getBox(Number(pr.to)))?.name ?? pr.to}`, { voicemailId: id });
        h.sp(vr, ctx, "vm_msg_sent");
        return done();
      }
      if (d === "2" && id) {
        vr.play(voicemailPlayLink(id, 1));
        return h.back(vr, "vm-rec-review", pr);
      }
      if ((d === "3" || d === "*") && id) await db.update(schema.voicemails).set({ state: "replaced" }).where(eq(schema.voicemails.id, id));
      if (d === "3") return startRecording(vr, ctx, "vm_record_msg", "vm-rec-done", { to: pr.to, k: pr.k, b: pr.b, m: pr.m, v: pr.v });
      if (d === "*") {
        h.sp(vr, ctx, "vm_canceled");
        return done();
      }
      return wrong(vr, ctx, "vm-rec-review", pr);
    },

    // ---- greetings and personal options (only the signed-in person's own box) ----
    "vm-greet"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const g = keys(vr, "vm-greet-key");
      h.sp(g, ctx, "vm_greet_menu");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-greet");
    },
    async "vm-greet-key"(ctx, vr) {
      const box = await getBox(ownBox(ctx));
      const d = ctx.body.Digits;
      if (!box) return h.back(vr, "vm-start");
      if (d === "*") return h.back(vr, "vm-main", { s: 1 });
      if (d === "1") {
        if (box.greetingKey) vr.play(r2AudioLink(box.greetingKey));
        else h.sp(vr, ctx, "vm_no_greeting");
        return h.back(vr, "vm-greet");
      }
      if (d === "2") return startRecording(vr, ctx, "vm_greet_record", "vm-grec-done", { k: "greeting" }, 60);
      if (d === "3") {
        if (box.greetingKey) await r2Delete(box.greetingKey).catch(() => null);
        await db.update(schema.voicemailBoxes).set({ greetingKey: null }).where(eq(schema.voicemailBoxes.id, box.id));
        await log(ctx, "Chose the standard greeting");
        h.sp(vr, ctx, "vm_greet_standard");
        return h.back(vr, "vm-greet");
      }
      return wrong(vr, ctx, "vm-greet");
    },
    async "vm-grec-done"(ctx, vr) {
      const k = q(ctx, "k") === "name" ? "name" : "greeting";
      const key = `voicemail/${k}/${ownBox(ctx)}-${Date.now()}.wav`;
      const ok = ctx.body.RecordingUrl ? await saveRecordingToR2(ctx.body.RecordingUrl, key).catch(() => false) : false;
      if (!ok) {
        h.sp(vr, ctx, "vm_not_valid");
        return h.back(vr, k === "name" ? "vm-opts" : "vm-greet");
      }
      return h.back(vr, "vm-grev", { k, key });
    },
    "vm-grev"(ctx, vr) {
      const pr = { k: q(ctx, "k"), key: q(ctx, "key") };
      const g = keys(vr, "vm-grev-key", pr);
      h.sp(g, ctx, "vm_review");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-grev", pr);
    },
    async "vm-grev-key"(ctx, vr) {
      const k = q(ctx, "k") === "name" ? "name" : "greeting";
      const key = q(ctx, "key") ?? "";
      const d = ctx.body.Digits;
      const box = await getBox(ownBox(ctx));
      if (!box || !key.startsWith("voicemail/")) return h.back(vr, "vm-main", { s: 1 });
      if (d === "1") {
        const old = k === "name" ? box.nameKey : box.greetingKey;
        await db.update(schema.voicemailBoxes).set(k === "name" ? { nameKey: key } : { greetingKey: key }).where(eq(schema.voicemailBoxes.id, box.id));
        if (old) await r2Delete(old).catch(() => null);
        await log(ctx, k === "name" ? "Recorded a name" : "Recorded a personal greeting");
        h.sp(vr, ctx, k === "name" ? "vm_name_saved" : "vm_greet_saved");
        return h.back(vr, k === "name" ? "vm-opts" : "vm-greet");
      }
      if (d === "2") {
        vr.play(r2AudioLink(key));
        return h.back(vr, "vm-grev", { k, key });
      }
      if (d === "3" || d === "*") await r2Delete(key).catch(() => null);
      if (d === "3") return startRecording(vr, ctx, k === "name" ? "vm_name_record" : "vm_greet_record", "vm-grec-done", { k }, k === "name" ? 10 : 60);
      if (d === "*") return h.back(vr, k === "name" ? "vm-opts" : "vm-greet");
      return wrong(vr, ctx, "vm-grev", { k, key });
    },
    "vm-opts"(ctx, vr) {
      if (!signedIn(ctx)) return h.back(vr, "vm-start");
      const g = keys(vr, "vm-opts-key");
      h.sp(g, ctx, "vm_personal");
      h.backLine(g, ctx);
      return noKey(vr, ctx, "vm-opts");
    },
    async "vm-opts-key"(ctx, vr) {
      const d = ctx.body.Digits;
      const box = await getBox(ownBox(ctx));
      if (!box) return h.back(vr, "vm-start");
      if (d === "*") return h.back(vr, "vm-main", { s: 1 });
      if (d === "1") return h.back(vr, "vm-np");
      if (d === "2") return startRecording(vr, ctx, "vm_name_record", "vm-grec-done", { k: "name" }, 10);
      if (d === "3") {
        await setAlerts(box, !box.alertsOn);
        await log(ctx, box.alertsOn ? "Turned new message alerts off" : "Turned new message alerts on");
        h.sp(vr, ctx, box.alertsOn ? "vm_alerts_off" : "vm_alerts_on");
        return h.back(vr, "vm-opts");
      }
      return wrong(vr, ctx, "vm-opts");
    },
    "vm-np"(ctx, vr) {
      const g = keys(vr, "vm-np2", {}, { numDigits: 9, finishOnKey: "#" });
      h.sp(g, ctx, "vm_newpin");
      return noKey(vr, ctx, "vm-np");
    },
    async "vm-np2"(ctx, vr) {
      const pin = (ctx.body.Digits ?? "").replace(/\D/g, "");
      if (!/^\d{4,8}$/.test(pin)) {
        h.sp(vr, ctx, "vm_newpin_nomatch");
        return h.back(vr, "vm-np");
      }
      const bcrypt = (await import("bcryptjs")).default;
      await h.update(ctx.callSid, { data: { vmNewPin: await bcrypt.hash(pin, 8) } }, ctx.session);
      const g = keys(vr, "vm-np-save", {}, { numDigits: 9, finishOnKey: "#" });
      h.sp(g, ctx, "vm_newpin_again");
      return h.back(vr, "vm-np");
    },
    async "vm-np-save"(ctx, vr) {
      const pin = (ctx.body.Digits ?? "").replace(/\D/g, "");
      const first = String(data(ctx).vmNewPin ?? "");
      const bcrypt = (await import("bcryptjs")).default;
      await h.update(ctx.callSid, { data: { vmNewPin: undefined } }, ctx.session);
      if (!first || !(await bcrypt.compare(pin, first))) {
        h.sp(vr, ctx, "vm_newpin_nomatch");
        return h.back(vr, "vm-np");
      }
      await setBoxPin(ownBox(ctx), pin);
      await log(ctx, "Changed the password");
      h.sp(vr, ctx, "vm_newpin_saved");
      return h.back(vr, "vm-opts");
    },
  };
}
