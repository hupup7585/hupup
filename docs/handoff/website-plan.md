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
| W2 | Website words in Admin: the home page sections (slogan, intro, why-choose list, how-it-works steps, delivery notes, call-to-action, hours note, catalog line) in All settings as customer words: draft, publish with approval, history, undo. Defaults = today's words. | Next |
| W3 | Search listing in Admin: each public page's title and description (the words Google shows), with checks (length, unique, business name kept). | Planned |
| W4 | Website switches and numbers in Admin: catalog card on/off, catalog sends per address per day (10), with explanations. | Planned |
| W5 | Website preview in Admin: the home page with the drafts, side by side with live (nothing saved, nothing public). | Planned |

Not planned without Abraham's OK: the legal pages (Terms, Privacy, SMS Terms) stay in code because their words are
carrier and legal records; the rental categories already come from Admin Catalog.
