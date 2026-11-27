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

## Status right now (Nov 27, 04:05 ET)

**Vercel is refusing every live and preview deploy ("rate limited").** The live site is still on `c4a7e20`
(deployed 02:54 ET). Every merge since then is waiting, not live. Do not merge to the live branch until Vercel
accepts deploys again; the first accepted deploy takes everything merged so far in one go. Keep working and testing
on your own branch. (A session updating this note when the limit clears: change it to "OK".)

## What builds on Vercel

Only two branches build. Everything else is skipped (vercel.json `git.deploymentEnabled`, plus the project's
Ignored Build Step as a backup):

| Branch | Builds as |
|---|---|
| `claude/nifty-mendel-7hlzdb` | Production (hupupattractions.com) |
| `claude/nifty-mendel-7hlzdb-website` | Preview (noindex) |
| any other `claude/*` session branch | **not built** — test locally |

## Rules

1. **Batch your merges.** Merge to the live branch at most about **once every 30 minutes**, or several finished
   fixes at once. Do not merge one small fix at a time. 30 minutes is about 48 merges a day = 96 deployments,
   already near the 100 limit, so fewer is better.
2. **Before every merge to the live branch**, on your own branch:
   ```bash
   git fetch origin claude/nifty-mendel-7hlzdb
   git merge origin/claude/nifty-mendel-7hlzdb   # or rebase your own unpushed commits
   npm run typecheck
   npm test
   npm run build
   ```
   All four must pass. `npm run build` matters: `typecheck` alone missed the Nov 26 failure
   (`28d0783`: a route file exported `dueNow`, which Next.js does not allow in a route file).
   Do not put extra exports in `src/app/**/route.ts` or `page.tsx`; move helpers to `src/lib`.
3. **No bookkeeping commits on the live branch.** Status notes such as "item 18 in progress by ..." in the deep check
   list cost two deployments each. Keep them on your own branch and bring them along with your next real merge.
4. **Push the live branch and the preview branch in one go** (same commit), not one after the other with new commits.
5. **Never force-push** the live or preview branch. If a push is rejected, fetch, merge, test again, push.
6. **If Vercel says "rate limited"**: stop merging. Do not retry, do not push empty commits, do not create
   deployments by hand. Tell Abraham. Capacity comes back as day-old deployments age out (rolling 24 hours).
7. **If a deploy fails**: the site keeps serving the last good deployment. One GitHub issue labeled
   `vercel-deploy-failed` opens automatically (later failures are added to it as comments). Close it when deploys work again. Fix it in one commit, run rule 2, merge once.
8. After your merge, check the deployment reached READY (Vercel `list_deployments` for the commit) and report it.
9. Hobby cron jobs run at most once a day. The 5-minute jobs run from the free Cloudflare scheduler (`docs/cloudflare-scheduler.md`).

## Note on the build

`vercel-build` runs database migrations and the seed **before** `next build`. A build that fails at the Next.js step
has already applied its migrations to the database. Keep migrations additive (new tables or columns, never drops or
renames) so the live site, still on the older code, keeps working.
