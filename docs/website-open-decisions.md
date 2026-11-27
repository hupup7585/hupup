# Open decisions for Abraham: website

Website session (Nov 27, 2026). Items built and tested but waiting for Abraham's OK on exact customer-facing
wording. Nothing below shows on the live site until he approves it word for word.

| # | What | Draft wording (exact) | Where it shows now |
|---|---|---|---|
| W1 | Error page when a website page breaks while loading | DECIDED by Abraham, Nov 27, 2026 (item 7): "We apologize, this page is temporarily unavailable. Please try again in a few minutes. For immediate assistance, please call us at (845) 777-7585." with one button "Back to homepage", the site header and footer. | Live everywhere (error.tsx, global-error.tsx, not-found.tsx; `src/lib/error-page-copy.ts`) |
