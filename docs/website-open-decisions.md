# Open decisions for Abraham: website

Website session (Nov 27, 2026). Items built and tested but waiting for Abraham's OK on exact customer-facing
wording. Nothing below shows on the live site until he approves it word for word.

| # | What | Draft wording (exact) | Where it shows now |
|---|---|---|---|
| W1 | Error page when a website page breaks while loading (today the live site shows Next's plain technical error screen) | Heading: "Something went wrong." Line: "Please try again, or call us at (845) 777-7585." Button: "Try again". Second button: "Hup Up Attractions" (goes home, same as the 404 page). | Preview only. Live switch: `ERROR_PAGE_LIVE_APPROVED` in `src/lib/error-page-copy.ts` |
