# Admin handoff: the website part (website session, Nov 27, 2026)

The Admin-editable handoff (Phases 1-4 on Nov 26: phone baseline, All settings with drafts and publish, phone timing,
screens and recordings, offers) did not have a written website part in the repo. This is the website part, worked
out from the phases already built so it uses the same tools (All settings, drafts, "I approve these exact words",
history, undo). **Abraham or Hark: if the handoff document has its own website section, it replaces this plan.**

Rules for every phase: nothing on the website changes until the Owner changes it in Admin; the defaults are exactly
today's words and settings; every Admin item has a plain-English explanation; customer words publish only with
"I approve these exact words"; free options only; Shabbes/Yom Tov rules and approved texts stay as written.

| Phase | What | Status |
|---|---|---|
| W1 | Baseline: what every public page shows today (rendered pages in `website-baseline.json` by `scripts/website-baseline.mjs`; every website text and page title/description in `tests/baseline/website-baseline.test.ts`). Every page has one H1. | Done |
| W2 | Website words in Admin: 15 home page texts (slogan, line under it, Why Choose list, the three steps, delivery lines, yellow call band, hours box) in All settings, group "Website: home page", as customer words: draft, publish only with "I approve these exact words", history, undo. Defaults = today's words; the rendered pages match the W1 baseline. The catalog line (it holds the email link) stays in code for now. | Done |
| W3 | Search listing in Admin: the title and description of 5 public pages (home, privacy, terms, text message terms, text updates) in All settings, group "Website: search listing", as customer words; checks: business name in every title, each title unique, 10-75 / 50-300 characters, plain one-line words. Starting values are today's; the rendered pages match the W1 baseline. | Done |
| W4 | Website switches and numbers in Admin: catalog card on/off, catalog sends per address per day (10), with explanations. | Next |
| W5 | Website preview in Admin: the home page with the drafts, side by side with live (nothing saved, nothing public). | Planned |

Not planned without Abraham's OK: the legal pages (Terms, Privacy, SMS Terms) stay in code because their words are
carrier and legal records; the rental categories already come from Admin Catalog.
