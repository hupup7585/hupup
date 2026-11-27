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

## Check before every merge to the live branch

The daily allowance is used up for most of Nov 27: 128 deployments in the 24 hours to 06:55 ET. A slot only comes
back when a deployment turns 24 hours old, so from about 1:40 PM ET on Nov 27 a merge gets through roughly every
10 to 20 minutes, and capacity only really returns overnight. Before merging, look at what Vercel said about the
live branch's last commit:

```bash
gh api repos/hupup7585/hupup/commits/claude/nifty-mendel-7hlzdb/statuses --jq '[.[]|select(.context=="Vercel")][0]|.state+" "+.description+" "+.created_at'
```

- `success ...` and more than 30 minutes ago: OK to merge (rule 2 first).
- `pending ...`: a deploy is building; wait for it.
- `failure Deployment rate limited ...`: a refused push uses no slot, so you may still merge a finished, tested
  batch, but it will not go live until a slot opens. The first accepted deploy takes everything merged so far in one
  go. Never retry, push empty commits or create deployments by hand to force it.
- `failure` for any other reason: the build is broken; see rule 7.

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
6. **If Vercel says "rate limited"**: nothing is broken; the site stays on its last deploy. Keep batching (rule 1).
   Do not retry, do not push empty commits, do not create
   deployments by hand (no `create_deployment`: each one uses a slot too). Tell Abraham. Capacity comes back as day-old deployments age out (rolling 24 hours).
7. **If a deploy fails**: the site keeps serving the last good deployment. One GitHub issue labeled
   `vercel-deploy-failed` opens automatically (later failures are added to it as comments). Close it when deploys work again. Fix it in one commit, run rule 2, merge once.
8. After your merge, check the deployment reached READY (Vercel `list_deployments` for the commit) and report it.
9. Hobby cron jobs run at most once a day. The 5-minute jobs run from the free Cloudflare scheduler (`docs/cloudflare-scheduler.md`).

## Note on the build

`vercel-build` runs database migrations and the seed **before** `next build`. A build that fails at the Next.js step
has already applied its migrations to the database. Keep migrations additive (new tables or columns, never drops or
renames) so the live site, still on the older code, keeps working.
