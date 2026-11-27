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
3. **Same-day area settings.** "Same-day delivery time close by", "surrounding areas" and "Close-by areas" in
   Hours and calendar are not used since the Nov 27 same-day notice (two versions by customer service hours). They
   are kept and labelled "Not used now". Remove them, or use areas again?
