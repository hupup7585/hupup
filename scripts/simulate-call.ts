/**
 * Simulates a Twilio phone call against a running server (npm run dev).
 * Follows <Redirect>, feeds scripted keypad/speech answers to each <Gather>, and prints what the voice says.
 *
 *   npx tsx scripts/simulate-call.ts                      # full booking
 *   npx tsx scripts/simulate-call.ts --hangup-after-cart  # caller drops with items in cart
 *
 * If TWILIO_AUTH_TOKEN is set, requests are signed like real Twilio requests.
 */
import "dotenv/config";
import twilio from "twilio";

const BASE = process.env.SIM_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:3000";
const CALL_SID = `CA_SIM_${Date.now()}`;
const FROM = process.env.SIM_FROM || "+18455550199";

type Input = { digits?: string; speech?: string };
const args = process.argv.slice(2);
const dateArg = args.find((a) => a.startsWith("--date="))?.split("=")[1] ?? "next friday";
const hangupAfterCart = args.includes("--hangup-after-cart");

const script: Input[] = hangupAfterCart
  ? [{ digits: "1" }, { digits: "1" }, { digits: "2" }, { speech: dateArg }, { digits: "1" }, { digits: "1" }]
  : [
      { digits: "1" }, // Bounce Houses
      { digits: "1" }, // first item
      { digits: "1" }, // hear description
      { digits: "2" }, // add to cart
      { speech: dateArg }, // date by voice
      { digits: "1" }, // confirm date
      { digits: "1" }, // quantity (if asked)
      { digits: "9" }, // checkout
      { digits: "1" }, // cart: check out
      { speech: "my name is yossi friedman" },
      { digits: "1" },
      { speech: "12 Forest Road, Kiryas Joel" },
      { digits: "1" },
      { speech: "yossi at gmail dot com" },
      { digits: "1" },
      { digits: "1" }, // use caller ID number
    ];

function attrs(tag: string) {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/(\w+)="([^"]*)"/g)) out[m[1]] = m[2].replace(/&amp;/g, "&");
  return out;
}

async function post(url: string, extra: Record<string, string>) {
  const body = new URLSearchParams({ CallSid: CALL_SID, From: FROM, To: "+18450000000", ...extra });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (process.env.TWILIO_AUTH_TOKEN) {
    headers["X-Twilio-Signature"] = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, Object.fromEntries(body));
  }
  const res = await fetch(url, { method: "POST", body, headers });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${await res.text()}`);
  return res.text();
}

async function main() {
  let url = `${BASE}/api/voice/incoming`;
  let params: Record<string, string> = {};
  let step = 0;
  for (let hops = 0; hops < 80; hops++) {
    const xml = await post(url, params);
    params = {};
    // Twilio stops at a Gather that gets input, so only print speech up to it.
    const spoken = xml.split("</Gather>")[0];
    for (const m of spoken.matchAll(/<Say[^>]*>([\s\S]*?)<\/Say>/g)) console.log(`  🔊 ${m[1].replace(/&apos;/g, "'").replace(/&amp;/g, "&")}`);
    const gather = /<Gather([^>]*)>/.exec(xml);
    if (gather) {
      const a = attrs(gather[1]);
      const input = script[step++];
      if (!input) {
        console.log("— script finished; hanging up —");
        break;
      }
      console.log(input.digits ? `  ☎️  caller presses ${input.digits}` : `  🗣  caller says "${input.speech}"`);
      url = a.action;
      params = input.digits ? { Digits: input.digits } : { SpeechResult: input.speech!, Confidence: "0.92" };
      continue;
    }
    if (/<Hangup\/>/.test(xml)) {
      console.log("— call ended by system —");
      break;
    }
    const redirect = /<Redirect[^>]*>([\s\S]*?)<\/Redirect>/.exec(xml);
    if (redirect) {
      url = redirect[1].replace(/&amp;/g, "&");
      continue;
    }
    console.log("— no further instructions —");
    break;
  }
  // Twilio's status callback when the line disconnects:
  await post(`${BASE}/api/voice/status`, { CallStatus: "completed" });
  console.log(`(sent call-ended status for ${CALL_SID})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
