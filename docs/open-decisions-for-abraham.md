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

## Admin and Bookkeeping (Admin session, Nov 27, 2026)

1. **Possible duplicate customers: consent and terms records on a merge.** Hark's item 2 said a merge moves the
   consent records to the kept record. The texting-consent and Terms records are locked by the database as legal
   records (they can never be edited), so a merge leaves them exactly as written on the merged record. They are still
   found by phone number as before, and the kept customer's page links to every record merged into it. Is that OK?
   (Orders, payments, texts, invoices, emails and notes do move; nothing is deleted; a STOP on any record wins.)
2. **Overpayments in Bookkeeping.** A second charge on an order already paid in full is now booked as
   "Overpayment (refund due)" (not a tip, not a taxable sale), and refunding it gives back no sales tax. Say if your
   accountant wants it shown another way.
3. **"Close-by areas" for the same-day notice.** Since the Nov 27 same-day notice (two versions by customer service
   hours) this list is not read; it is kept and labelled "Not used now". Remove it, or use areas again? (The two
   same-day hours settings still matter: changing one marks the same-day notice recordings for a new recording.)
4. **Item types (Catalog > Item types).** New booking and the laser gun stock follow the types you set there. The
   phone line, the prices and the offers still work them out from the names until they are connected (phone/payments
   session). Until then, if you set a type that differs from an item's name, New booking and the phone can disagree, so
   please leave the list as it is until that is done.

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

## Opt-out words with a space (extra check J5, Nov 27, 2026)

When someone texts "Opt out" or "Stop all" (with a space), the app records the opt-out but sends no confirmation,
expecting Twilio to send it (as Twilio does for STOP). If Twilio does not answer these with a space, the customer gets
no confirmation. One test text of "Opt out" from a test phone will show which it is; then the app can send the one
confirmation itself when Twilio doesn't. Nothing was changed, so a customer never gets two confirmations.

14. **Catalog email read-back (`catalog_got`, phone audit 2):** still "We got {letters}. To continue, press pound. To
    start over, press 1. To add more, press 2." The pound rule (Nov 23) says confirm lines end with the shared confirm
    ending (1 = correct, 2 = again). New words needed, including how "add more" fits.
15. **"Something went wrong" line (`went_wrong`, phone audit 3):** it still says "Let us head back to the main menu", but
    the phone now goes back one step instead. New words needed.
16. **Sola PhonePay "Only test calls" (phone audit 5):** the box is unticked in Admin. Is card-by-phone meant to be live
    for every caller now? (Nothing was changed.)
17. **Terms notice (`terms_notice`, phone audit 15):** still says "press #". It is not active on the live line; new words
    are needed before it is turned on.
18. **Two after-hours voicemail greetings (phone audit 17):** `vm_after_hours` (approved Nov 13) and `vm_closed`. Pick
    one; the other is retired.
19. **"(pickup {date})" in delivery texts (phone audit 26):** keep, or a different word?
20. **Slot file check (phone audit 16, Hark):** the "Address step 1 - house number" slot holds a file named "22 Address
    step 2 - house number.mp3". Please listen in Admin and re-upload if it is the wrong recording.
21. **Laser packs and the $5 extra-item charge (deep check M15):** today the phone/saved order counts 3 sets of one kind
    as 1 item, the New booking screen as 3 ($20 vs $10 delivery). Which is right? Both will be made the same once you say.
22. **Same-day cut-off during checkout (deep check M66):** the cut-off is checked at the date step only. Re-checking at
    checkout needs the `same_day_closed` words (still waiting) so the caller hears why.

## Invoice page description (deep check 06:00, Nov 27, 2026)

The customer's invoice page (opened from the invoice link) now has its heading. It still has no page description
(the short text a phone may show under a shared link). The page is hidden from Google, so this only matters for link
previews. Suggested wording, not used until approved: "Your invoice from Hup Up Attractions. View or print it here."


## Phone booking and payments (deep check 09:00 list, Nov 27, 2026, claude/ecstatic-clarke-x12we8)

23. **Text updates question (Box 49) after many wrong keys (P15):** today a wrong key plays "Sorry, that is not a valid
    selection." and Box 49 again, with no limit (your Nov 16 rule for every menu). Should it stop after some number of
    wrong keys, and then what: no texts and on with checkout (as with no key), or something else? Nothing was changed.
24. **Payment link already sent when the Shabbes cut-off comes (P22):** the cut-off saves the cart and turns the order
    back into a held cart, so after Shabbes "welcome back" can offer it on the phone, but the payment link the caller
    already got says "This order is not waiting for payment". Which do you want after Shabbes (until one hour after the
    phone reopens)? (a) As today: the phone's welcome back, the link no longer works; or (b) the link works again, and
    the phone has no welcome back for that order (both at once would hold the items twice). Nothing was changed.
