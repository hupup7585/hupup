/**
 * Sola hang-up helper (Abraham, Nov 18, 2026, option a). Free Cloudflare plan: a Worker and one Durable Object per card
 * try. Twilio sends it the audio of the call to Sola PhonePay (Media Streams). It never decides the result: Sola's
 * record does (our site checks it every second). It only times the hang-up:
 *  - after our site says Sola's record shows approved or declined (POST /result/<try>), it waits until Sola has been
 *    quiet for about half a second (the end of Sola's sentence), then asks our site to hang up the call to Sola;
 *  - silence check: no Sola voice, no caller key tones and no result for N seconds (Admin setting, 20 to start): it asks
 *    our site to check Sola's record once more (our site hangs up and plays box 147 when there is still no result).
 * No card digits are kept or sent anywhere: the audio is only measured for loudness, never stored or transcribed.
 * Our site's addresses (signed by our site) arrive in the stream's start message.
 * Key (deep check Nov 27, item 18): every /stream and /result address carries a key made from the try number and the
 * Worker secret LISTEN_KEY (the same value as SOLA_LISTEN_KEY in Vercel). Without the secret, or with a wrong key, the
 * Worker answers 403, so nobody else can open a stream or end a payment call. Set it once (free):
 *   npx wrangler secret put LISTEN_KEY --name hupup-sola-listen
 */

const VOICE_RMS = 700; // 16-bit loudness that counts as someone talking (phone audio)

/** One mu-law byte to 16-bit linear. */
function ulaw(b) {
  b = ~b & 0xff;
  const sign = b & 0x80;
  const exponent = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  let s = ((mantissa << 3) + 0x84) << exponent;
  s -= 0x84;
  return sign ? -s : s;
}

/** Loudness (RMS) of a base64 mu-law frame. */
export function frameRms(b64) {
  const bin = atob(b64);
  if (!bin.length) return 0;
  let sum = 0;
  for (let i = 0; i < bin.length; i++) {
    const v = ulaw(bin.charCodeAt(i));
    sum += v * v;
  }
  return Math.sqrt(sum / bin.length);
}

/** Same key, compared in constant time. An empty key never matches. */
export function sameKey(a, b) {
  if (!a || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export class SolaListen {
  constructor(state) {
    this.state = state;
    this.ws = null;
    this.urls = null; // { hangup, silence } from our site (signed)
    this.key = ""; // this try's key from our site (stream start message); the result notice must carry it
    this.solaTrack = "inbound";
    this.pauseMs = 500;
    this.silenceMs = 20000;
    this.lastSola = 0;
    this.lastActivity = Date.now();
    this.resultAt = 0;
    this.done = false;
    this.silenceAsked = false;
    this.timer = null;
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.accept(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname.startsWith("/result/")) {
      // Only our site knows this try's key; without the stream's key nothing is accepted
      if (!sameKey(this.key, req.headers.get("X-Listen-Key"))) return Response.json({ listening: false }, { status: 403 });
      // Sola's record shows approved or declined: hang up at the end of Sola's sentence
      if (!this.resultAt) this.resultAt = Date.now();
      return Response.json({ listening: Boolean(this.ws && this.urls) && !this.done });
    }
    return new Response("Not found", { status: 404 });
  }

  accept(ws) {
    ws.accept();
    if (this.timer) clearInterval(this.timer);
    // A new stream for this try (the backup number): start fresh; a result already in still counts
    this.ws = ws;
    this.urls = null;
    this.lastSola = 0;
    this.done = false;
    this.silenceAsked = false;
    this.lastActivity = Date.now();
    ws.addEventListener("message", (ev) => this.onMessage(ev.data));
    ws.addEventListener("close", () => this.ws === ws && this.stop());
    ws.addEventListener("error", () => this.ws === ws && this.stop());
    this.timer = setInterval(() => this.tick(), 100);
  }

  onMessage(data) {
    let m;
    try {
      m = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));
    } catch {
      return;
    }
    const now = Date.now();
    if (m.event === "start") {
      const p = (m.start && m.start.customParameters) || {};
      this.urls = { hangup: p.hangup, silence: p.silence };
      if (typeof p.key === "string" && p.key) this.key = p.key;
      this.solaTrack = p.solaTrack === "outbound" ? "outbound" : "inbound";
      this.pauseMs = Number(p.pauseMs) || 500;
      this.silenceMs = (Number(p.silenceSec) || 20) * 1000;
      this.lastActivity = now;
    } else if (m.event === "media" && m.media) {
      if (frameRms(m.media.payload) >= VOICE_RMS) {
        this.lastActivity = now; // Sola talking, or the caller's key tones
        if ((m.media.track || "inbound") === this.solaTrack) this.lastSola = now;
      }
    } else if (m.event === "dtmf") {
      this.lastActivity = now;
    } else if (m.event === "stop") {
      this.stop();
    }
  }

  tick() {
    if (this.done || !this.urls) return;
    const now = Date.now();
    // After the result: Sola quiet for about half a second = the end of its sentence
    if (this.resultAt && now - this.lastSola >= this.pauseMs && now - this.resultAt >= 200) {
      this.done = true;
      this.call(this.urls.hangup);
      return;
    }
    // Silence check (only before a result): nobody talking, no keys, for the set seconds
    if (!this.resultAt && !this.silenceAsked && now - this.lastActivity >= this.silenceMs) {
      this.silenceAsked = true;
      this.call(this.urls.silence).then((r) => {
        // Our site found a result after all: hang up at the end of Sola's sentence, as usual
        if (r && r.result) this.resultAt = Date.now();
        else this.done = true;
      });
    }
  }

  async call(url) {
    if (!url) return null;
    try {
      const r = await fetch(url, { method: "POST" });
      return await r.json().catch(() => null);
    } catch {
      return null;
    }
  }

  stop() {
    this.done = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.ws = null;
  }
}

/** The key for one try: the first 32 hex characters of HMAC-SHA256(secret, "sola-listen:<try>") (same as our site). */
export async function tryKey(secret, tryId) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`sola-listen:${tryId}`)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Same length and same characters, without stopping at the first difference. */
function sameKey(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/(stream|result)\/(\d+)\/([0-9a-f]{32})$/);
    if (!m) return new Response("Hup Up Attractions", { status: 200 });
    // No secret set, or a wrong key: nothing is opened or ended
    const secret = env.LISTEN_KEY;
    if (!secret || secret.length < 24 || !sameKey(await tryKey(secret, m[2]), m[3])) return new Response("Forbidden", { status: 403 });
    const stub = env.LISTEN.get(env.LISTEN.idFromName(`try-${m[2]}`));
    return stub.fetch(req);
  },
};
