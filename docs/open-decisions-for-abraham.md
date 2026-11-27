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
