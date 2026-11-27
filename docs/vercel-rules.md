# Vercel rules for every Claude session (Hup Up Attractions)

Read this before you push or merge. Several Claude sessions push to this repo at the same time.
We are on Vercel **Hobby (free)** and must stay free: never upgrade, buy credits, or turn on anything paid.
Never delete deployments, projects or data.

## Why (numbers from Nov 27, 2026, 03:30 ET)

- 118 deployments in 24 hours: 116 from the live and preview branches (one pair per merge), 2 from session branches.
  All ready except 2 failed (`28d0783`, Nov 26) and 1 canceled.
- Hobby allows **100 deployments per day**. We hit it: Vercel refused commit `4b00714` on the live branch at 03:31 ET
  ("Deployment rate limited — retry in 24 hours"), so that fix did not go live. The website preview of `c4a7e20` was refused too.
- Each build takes about 2.5 to 3 minutes, and Hobby runs one build at a time, so extra builds also delay live fixes.
- Every merge costs **two** deployments: the live branch and the preview branch.

## Who merges to live (Abraham, approved Nov 27, 2026, 10:08 AM ET)

**Only the main phone session merges to the live branch, once every 2 hours.** Every other session:

- Does **not** merge or push to `claude/nifty-mendel-7hlzdb` or `claude/nifty-mendel-7hlzdb-website`. Ever.
- Pushes only to its own `claude/*` branch, with tests and build passing (rule 2), then posts
  `ready to merge: <branch>, <items>`.

12 merges a day x 2 deployments (live + preview) = 24 deployments, well inside the free 100.

## What builds on Vercel

Only two branches build. Everything else is skipped (vercel.json `git.deploymentEnabled`, plus the project's
Ignored Build Step as a backup):

| Branch | Builds as |
|---|---|
| `claude/nifty-mendel-7hlzdb` | Production (hupupattractions.com) |
| `claude/nifty-mendel-7hlzdb-website` | Preview (noindex) |
| any other `claude/*` session branch | **not built** — test locally |

## Rules for every session

1. **Push only to your own branch.** Not to the live or preview branch (see above).
2. **Before you post "ready to merge"**, on your own branch:
   ```bash
   git fetch origin claude/nifty-mendel-7hlzdb
   git merge origin/claude/nifty-mendel-7hlzdb   # bring in everyone's latest work
   npm run typecheck
   npm test
   npm run build
   ```
   All four must pass on the merged result, then push your branch. `npm run build` matters: `typecheck` alone missed
   the Nov 26 failure (`28d0783`: a route file exported `dueNow`, which Next.js does not allow in a route file).
   Do not put extra exports in `src/app/**/route.ts` or `page.tsx`; move helpers to `src/lib`.
3. **Never force-push** any shared branch. If a push is rejected, fetch, merge, test again, push.
4. **Never create deployments by hand** (`create_deployment`, deploy hooks, empty commits): each uses a free slot.
5. Session branches do not build on Vercel, so test locally. Hobby cron jobs run at most once a day; the 5-minute
   jobs run from the free Cloudflare scheduler (`docs/cloudflare-scheduler.md`).

## Rules for the main phone session (the only one that merges)

1. **Every 2 hours**, merge every branch posted as "ready to merge" into your branch, one at a time. After all of
   them: `npm run typecheck`, `npm test`, `npm run build` on the combined result. Fix or leave out any branch that
   breaks it (tell its session).
2. Push the **same commit** to the live branch and the preview branch in one push:
   ```bash
   git push origin HEAD:claude/nifty-mendel-7hlzdb HEAD:claude/nifty-mendel-7hlzdb-website
   ```
3. Check Vercel's answer and report the deploy:
   ```bash
   gh api repos/hupup7585/hupup/commits/claude/nifty-mendel-7hlzdb/statuses --jq '[.[]|select(.context=="Vercel")][0]|.state+" "+.description+" "+.created_at'
   ```
   - `success`: report the commit and deploy ID.
   - `pending`: building; check again in a few minutes.
   - `failure Deployment rate limited`: nothing is broken; the site stays on its last deploy. Do not retry or deploy
     by hand. The next accepted push takes everything in one go. Slots come back as deployments turn 24 hours old.
   - any other `failure`: the build broke on Vercel. The site keeps the last good deployment. Fix in one commit,
     test, push once.
4. One GitHub issue labeled `vercel-deploy-failed` opens automatically on a failed live or preview deploy (later
   failures are added to it as comments). Close it when deploys work again.

## Note on the build

`vercel-build` runs database migrations and the seed **before** `next build`. A build that fails at the Next.js step
has already applied its migrations to the database. Keep migrations additive (new tables or columns, never drops or
renames) so the live site, still on the older code, keeps working.
