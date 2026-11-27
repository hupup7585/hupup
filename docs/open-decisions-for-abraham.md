# Open decisions for Abraham

Things built and live with a placeholder or the current behavior kept, waiting for Abraham's decision. Nothing here
changes until he decides.

## Payment links on Shabbes and Yom Tov (Nov 27, 2026, item 2)

Built: from the Erev Shabbes / Erev Yom Tov cut-off (Admin "phoneCutoffMinutes", 15 minutes before candle lighting,
same as the phone) until the phone reopens after Shabbes / Yom Tov, every payment link shows a closed notice with no
card form, and the server rejects any payment attempt. Right after Shabbes / Yom Tov ends the links work again.

1. **Closed-page wording (not approved).** Placeholder shown now: "Payments are closed at this time."
   (`PAYMENTS_CLOSED_PLACEHOLDER` in `src/lib/payments-closed.ts`). Please send the exact wording.
2. **Item hold on a link that would expire during Shabbes / Yom Tov.** Kept or released? Not decided: today's hold
   rules are unchanged (the hold ends at its normal time).
3. **Website checkout in the same window.** Should website checkout also close from the cut-off until Shabbes / Yom
   Tov ends? Not decided: website checkout is unchanged.

## Seasonal offers confirmation and first texts (Nov 27, 2026, items 3 and 5): built as asked, please confirm

- **Website sign-up box.** The website box still uses the YES double opt-in (SMS v3): the box sends the "reply YES"
  request, and the approved sign-up confirmation goes out when the customer replies YES (that is when the number
  joins). Say if the box should sign up straight away instead.
- **First text a number ever gets.** It now ends with exactly " Reply STOP to stop, or HELP for help." (catalog,
  order, payment link). For a brand-new number this replaces the longer first-text footer ("Msg frequency varies. Msg
  and data rates may apply. Reply STOP to opt out, HELP for help. Terms: link"), which still goes on the first order
  text after consent for a number we texted before.
- **Receipt "Total due".** The receipt email's grouped lines end with "Total due", which equals the amount just paid.
  Say if the receipt should use other words there (for example "Total paid").

## Phone, payments, texts and delivery (phone/payments session, Nov 27, 2026)

1. **4th Sunday + extra items.** Delivery on the 4th Sunday is 2x the zone price. Is the $5 for each additional item
   doubled too? Today: not doubled.
2. **Pack counting and the delivery promo with the $5 extra item.** Does a laser pack count as one item for the $5, and
   does the free-delivery promo also waive the $5? Today: each line counts; the promo does not waive the $5.
3. **Website catalog STOP message (preview only until approved):** "This number replied STOP to our texts, so we
   cannot text it. To get our texts again, text START to (845) 415-7585." The live site shows the existing
   "could not send" line meanwhile.
4. **Website "tick the box" message (preview only):** "Please tick the box to get the catalog by text." (The button is
   off until the box is ticked, so this only shows if the browser skips that.)
5. **JOIN from a number that never got the catalog text:** still the older confirm-with-YES text, or sign up at once
   like the catalog JOIN?
6. **Catalog by text: one text or the photo series?** Today the approved first text, then each catalog photo as its
   own text.
7. **Address check: Google Maps key.** No Google Maps key is set, so the free US Census Bureau answers first, then
   OpenStreetMap. A Google key needs a Google Cloud card (free credit, but a card), so it is off unless you want it.
8. **Hold music for staff transfers: caller ID.** With hold music on, staff phones show the hotline number, not the
   customer's (Twilio limit). The switch stays off until you decide.
9. **Technical error after a payment:** today the caller hears the error line and then the before-payment goodbye.
   Keep, or a different goodbye when the payment already went through?
10. **Clear cart confirm step:** should "clear cart" ask "press 1 to confirm" first? Today it clears at once.
11. **Same-day closed line** (`same_day_closed`) and the **Yom Tov cut-off words**: wording waits for you.
12. **Voicemail access PIN (deep check 19):** default 1234, 4 digits. A longer PIN, or no phone access until a PIN is
    set, changes what callers hear.
13. **Separate preview database (deep check 22):** needs Hark to create the free Neon project `hupup-preview` and set
    the Preview-only database settings in Vercel (steps were sent).

## Storage clean-up that would delete data (deep check B6 and C1, Nov 27, 2026)

The rule is never to delete live data, so these were not built. Both only free storage space.

1. **Old catalog photos.** When a photo is replaced in Admin, the old file stays in Cloudflare storage. Should it be
   removed?
2. **The raw copy of each incoming info@ email.** Each email is kept twice: once filed in the Admin inbox (text and
   attachments) and once as the original raw email. The raw copy is used to find the Reply-To address when replying.
   Should the raw copy be removed after some time (for example 90 days)?

## Cloudflare Workers to update (deep check C7, Nov 27, 2026)

The info@ email Worker (`cloudflare/info-inbox-worker.js`) was fixed: a Gmail forward error no longer stops the Admin
inbox copy, and a missing piece is logged. The new code takes effect once it is put on Cloudflare (free).

