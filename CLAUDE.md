# Working rules for this repo

- **Always redeploy on Vercel after any change.** The Vercel project `hupup` is connected to this GitHub repo, so every push deploys automatically. After pushing, confirm a new deployment started and reached READY (Vercel MCP `list_deployments` / `get_deployment`). If none started, trigger one with `create_deployment` from the pushed commit. Report the deployment URL and status.
- Vercel account is on the Hobby plan: cron jobs can run at most once a day.
- Business name is always "Hup Up Attractions".
- Before pushing: `npm run typecheck` and `npm test`.

## Go-live rule (Abraham, standing)
- Every piece that passes its tests goes live right away (push to the live branch `claude/nifty-mendel-7hlzdb` and keep the preview branch `claude/nifty-mendel-7hlzdb-website` in sync), no waiting for approval. Send Abraham a screenshot afterwards for anything visual.
- Only two things still wait for Abraham's OK: new or changed customer-facing wording he hasn't approved (website, phone prompts, customer texts and emails), and switching the public email to info@hupupattractions.com (`NEW_EMAIL_LIVE` in `src/lib/config.ts`).
- Work through the open to-do list without pausing between items.
- Never buy usage credits, upgrade a plan, or turn on anything that costs money.

## Key 8 rule (Abraham, standing)
- Every time main-menu key 8 (schools, corporate events and organizations) or its staff list is changed, run an extra key 8 test after the change (`npx vitest run tests/main-menu.test.ts -t "8"` plus a live check of the ring list) and report the result with the commit and deploy ID.

## Website SEO and tone rule (Abraham, applies to every website step)
- Follow Google's helpful, people-first content guidelines.
- Copy is humanized, friendly, warm and customer-friendly, in simple but professional English, with natural long-tail keywords (e.g. "bounce house rental in Kiryas Joel", "laser tag party rental Orange County NY", "paddle boat rental Monroe NY"). No keyword stuffing.
- Never change text Abraham dictated exactly (e.g. the hero subtitle, slogan, section copy in `src/lib/site-copy.ts`). Keyword work goes in titles, meta descriptions, alt text and structured data unless he asks.
- Technical SEO: a unique title and meta description per page, exactly one H1 per page, alt text on every meaningful image, and LocalBusiness schema (name Hup Up Attractions, phone (845) 777-7585, service area, hours).
- Sitemap and robots allow indexing on the live site only; every preview stays noindex (`src/lib/seo.ts`).
- Middletown is served but never shown on the public website.
- After any website text change, reply with every change as old → new so Abraham can review it on preview.
