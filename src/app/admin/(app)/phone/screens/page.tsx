import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { allSlots } from "@/lib/recording-slots";
import { customSlots } from "@/lib/custom-slots";
import { catalogItems } from "@/lib/slot-status";
import { db, schema } from "@/lib/db";
import { SCREENS, screenArea, screenLabel } from "@/lib/ivr/screens";

export const metadata = { title: "Phone screens | Hup Up Attractions" };
export const dynamic = "force-dynamic";

/** What each building block of the phone line does (everything already built), in plain words. */
const BLOCKS: [string, string][] = [
  ["Play recordings", "Plays one or more recorded lines in order. A line with no recording is read by the Google voice from its exact text."],
  ["Combined recording", "One recording for all of a menu's fixed lines. Once it is chosen, it plays instead of the separate lines."],
  ["Wait for a key", "Waits for the caller to press a key and does what that key is set to do. Star goes back, pound skips where a skip is allowed."],
  ["Keypad typing", "Takes numbers typed on the keypad: a date, quantity, zip code, phone number, order number or card number."],
  ["Spoken words", "Takes words said after the tone: a name, a street or a town, then reads them back."],
  ["Look something up", "Checks an item, stock on a date, whether a day is open, an address, a hall, an order or a customer."],
  ["Cart changes", "Adds an item, changes a quantity or removes an item from the cart."],
  ["Read the cart", "Reads each day in the cart and the total, before sales tax."],
  ["Take payment", "Card payment on the phone (Sola), or a payment link by text or email."],
  ["Send a text", "Sends a text or picture text to the caller (the catalog, a confirmation, a text set on a key)."],
  ["Ring a person", "Rings a staff extension with its hours, its ring list and its voicemail."],
  ["Voicemail", "Plays the box greeting, then records the caller's message into that box."],
  ["Go to a menu or step", "Sends the caller to another menu or step."],
  ["Go back or skip", "Star goes back one step; pound skips, only where a skip is allowed."],
  ["Goodbye", "Plays the goodbye line and hangs up."],
];

/** Where each kind of changing part gets its recordings (the recording groups), and how many are recorded. */
const PARTS: [string, string, RegExp][] = [
  ["Numbers", "Prices, quantities and order numbers, said one recording per number word or digit.", /number/i],
  ["Names", "Item names and rental types (customer names are said by the Google voice).", /item|rental|type/i],
  ["Dates and times", "Every date as weekday, month and ordinal day, and every time.", /dates and times/i],
  ["Addresses", "Streets, towns, zip codes, units and address words.", /street|town|zip|unit|address/i],
  ["Letters and digits", "For spelling and codes.", /letter/i],
  ["Cart details and totals", "Cart lines are recorded lines with the items, dates and money said from the groups above.", /^cart/i],
  ["Hours", "Key 7 reads the hours from the Hours page with the number and date word recordings, or plays its own recordings set on the Key 7 screen.", /dates and times|number clips/i],
];

export default async function ScreensPage() {
  await requireOwner();
  const slots = allSlots(await catalogItems(), {}, await customSlots());
  const inUse = new Set((await db.select({ key: schema.voicePrompts.key, rec: schema.voicePrompts.recordingId }).from(schema.voicePrompts)).filter((r) => r.rec).map((r) => r.key));
  const groups = [...new Set(slots.map((s) => s.group))];
  const areas = new Map<string, string[]>();
  for (const id of Object.keys(SCREENS).sort()) areas.set(screenArea(id), [...(areas.get(screenArea(id)) ?? []), id]);
  return (
    <div className="w-full" data-phone-screens>
      <h1 className="text-2xl font-black sm:text-3xl">Phone screens</h1>
      <p className="mb-5 mt-1 text-muted">
        Every phone screen, by extension. Open one to see its lines in play order, add or turn off lines, use its combined recording, and set what each key does. Nothing changes on the phone line until you turn a change on.
      </p>

      {[...areas.entries()].map(([area, ids]) => (
        <section key={area} className="card mb-5 p-5" data-screens-area={area}>
          <h2 className="mb-3 text-lg font-black">{area}</h2>
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {ids.map((id) => (
              <li key={id}>
                <Link href={`/admin/phone/screens/${encodeURIComponent(id)}`} className="block rounded-xl border border-line p-3 hover:bg-bg">
                  <span className="block font-bold">{screenLabel(id)}</span>
                  <span className="block text-xs text-muted">
                    {SCREENS[id].lines.length} lines · keys used: {SCREENS[id].keys || "none"}{SCREENS[id].combos.length ? " · combined recording" : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="card mb-5 p-5" data-building-blocks>
        <h2 className="mb-3 text-lg font-black">Building blocks (everything already built)</h2>
        <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {BLOCKS.map(([name, what]) => (
            <div key={name}>
              <dt className="font-bold">{name}</dt>
              <dd className="text-sm text-muted">{what}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card mb-5 p-5" data-changing-parts>
        <h2 className="mb-1 text-lg font-black">Changing parts and their recordings</h2>
        <p className="mb-3 text-sm text-muted">What the phone fills in each call, and the recordings it uses. Open a group to pick or replace its recordings.</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {PARTS.map(([name, what, re]) => {
            const gs = groups.filter((g) => re.test(g));
            return (
              <div key={name} className="rounded-xl border border-line p-3">
                <div className="font-bold">{name}</div>
                <div className="mb-2 text-sm text-muted">{what}</div>
                <ul className="text-sm">
                  {gs.map((g) => {
                    const list = slots.filter((s) => s.group === g);
                    return (
                      <li key={g}>
                        <Link className="text-navy underline" href={`/admin/phone/prompts/slots?g=${encodeURIComponent(g)}`}>{g}</Link>{" "}
                        <span className="text-muted">({list.filter((s) => inUse.has(s.key)).length} of {list.length} recorded)</span>
                      </li>
                    );
                  })}
                  {!gs.length && <li className="text-muted">Recorded lines on each screen.</li>}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
      <p className="text-sm"><Link className="text-navy underline" href="/admin/phone/screens/recordings">Every recording already made, by extension</Link></p>
    </div>
  );
}
