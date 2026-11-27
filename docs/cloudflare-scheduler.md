# Free scheduler on Cloudflare Workers

Hup Up Attractions, Nov 15, 2026. Free plan. No card is needed, and nothing here costs money.

## What it does
Vercel's free plan runs its own scheduler only once a day. A small Cloudflare Worker (`cloudflare/scheduler-worker.js`) calls the website every 5 minutes at `/api/cron/frequent`. Each run does three jobs:
- releases phone holds and unpaid orders whose time has run out
- sends any voicemail alert that never went out
- sends promotional texts that were held for quiet hours. Each one is checked again for consent and opt-out, and nothing is sent while promotional texts are switched off.

Every run is logged in Admin under failed jobs, retried, and the Owner gets an email if a job keeps failing. The daily Vercel job stays as a backup and still sends the weekly backup email.

## What it does not touch
- No R2 and no storage buckets. R2 waits until Abraham adds a card himself.
- No DNS changes and no routes on hupupattractions.com. The Worker uses only its own workers.dev address.

## Going live
This needs Hark's limited token, which can use Workers only.
1. `npx wrangler deploy --config cloudflare/wrangler.scheduler.toml`
2. `npx wrangler secret put CRON_SECRET --config cloudflare/wrangler.scheduler.toml`, using the same value as CRON_SECRET in Vercel.
3. Check it: open the Worker's workers.dev address. It should say "set up". In Admin, the jobs page shows a run every 5 minutes.

## To stop it
Delete the Worker in Cloudflare, or remove its schedule. The daily Vercel job keeps running.
