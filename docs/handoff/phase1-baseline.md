# Phase 1: discovery and baseline (Admin handoff, Nov 26, 2026)

Hup Up Attractions. What exists today, before any Admin-editability change. Every later phase is checked against
the baseline below: with no Admin setting changed, every phone step must play exactly as it does now.

## Baseline captured

| What | Count | Where |
| --- | --- | --- |
| Phone steps (every Twilio route the hotline answers) | 268 | `tests/baseline/phone-baseline.test.ts` snapshots each one (fixed moment: Wed Jan 13, 2027, noon ET) |
| Phone screens that wait for a key (Admin > Phone screens) | 86 | `src/lib/ivr/screens.ts` |
| Recording slots defined | 485 (81 retired, kept for the record) | `src/lib/ivr/prompts.ts` |
| Combined (whole-menu) recording slots | 32 | `whole_*` in `prompts.ts`, incl. `whole_stay_on_line`, `whole_skip_pound`, `whole_cart_key` |
| Business settings with defaults | 157 at the Phase 1 baseline; 206 on Nov 26, 2026 (count them with `Object.keys(SETTING_DEFAULTS).length`, never a text search) | `SETTING_DEFAULTS` in `src/lib/settings.ts` |
| Admin pages | 53 | `src/app/admin` |
| Database tables | 89 | `src/lib/db/schema.ts` |

The baseline test runs in the normal suite; a phase that changes what any step plays fails it until the change is a
deliberate, approved setting.

## Feature switches still set in code (Phase 2 moves them into one Admin registry)

| Switch | Now | File |
| --- | --- | --- |
| `PHONE_PROMO_MODE` (old 3-step promo flow) | off (the paid-order question `paid_promo_offer` is live) | `src/lib/phone-promo.ts` |
| `JOIN_INVITE_ON` | off | `src/lib/join-invite.ts` |
| `STRIPE_PHONE_PAY_MODE` | off (Owner test calls only) | `src/lib/phone-pay.ts` |
| `LIVE_REFUNDS_APPROVED` | off | `src/lib/refunds.ts` |
| `CALL_OUT_LIVE_APPROVED` (voicemail call-out) | off | `src/lib/vm-access.ts` |
| `MESSAGE_DUAL_DATES` (Hebrew dates in messages) | off | `src/lib/dual-date.ts` |
| `STAFF_PROMO_MODE` | Owner preview | `src/lib/staff-promo.ts` |
| Directory lookup before the name | preview only | `directoryLookupOn` in `flow.ts` |
| `PAY_DATES_LIVE` | on | `flow.ts` |
| `VM_ACCESS_LIVE_APPROVED`, `STT_LIVE_APPROVED`, `RECEIPT_APPROVED`, `INVOICE_EMAIL_APPROVED`, `LINK_WORDING_APPROVED`, `OPTIONS_WORDING_APPROVED`, `LATE_EMAIL_APPROVED`, `SMS_CATALOG_REPLY_ON`, `WEBSITE_CATALOG_FORM_LIVE_APPROVED`, `NEW_EMAIL_LIVE` | on | various |

`BOOK_R3C_LIVE` no longer exists (the hours line plays from its recording since Nov 26).

## Known defects from handoff section 16: status

| Item | Status |
| --- | --- |
| Combined slots `whole_stay_on_line`, `whole_skip_pound`, `whole_cart_key` in Admin | Present (32 combined slots) |
| Laser opening line editable | Present (`laser_open`) |
| Laser instruction parts 1 and 3 in the Key 2 library | Present (`instr_laser_1` to `_3`) |
| Balloon and paddle instructions ring Customer Service | Still so (scripts not approved) |
| "Check availability again" ignores Admin hold settings | **Fixed in Phase 1**: reads `adminLinkHoldMinutes` / `phoneLinkHoldMinutes` (defaults 25 / 10 unchanged), the pay page line too |
| Behavior inferred from category/item names (`/laser/`, `/maze/`, `/paddle/`, `/balloon/`) | 26 places; Phase 4 replaces them with explicit item types |
| Staff-wait music while extensions ring | Phase 3 |
| Boxes 48 and 49 | Box 49 (texting consent) is reached in checkout; box 48 read-back is reached from it |
| Inbound-text webhook domain | Twilio console setting; needs Hark/Owner to authorize the change |
| Legacy steps (`packs`, `added-second`, `product`, old pay screens) | Kept as redirects; Phase 3 marks them Not reached in Admin |
