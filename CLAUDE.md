# Working rules for this repo

- **Always redeploy on Vercel after any change.** The Vercel project `hupup` is connected to this GitHub repo, so every push deploys automatically. After pushing, confirm a new deployment started and reached READY (Vercel MCP `list_deployments` / `get_deployment`). If none started, trigger one with `create_deployment` from the pushed commit. Report the deployment URL and status.
- Vercel account is on the Hobby plan: cron jobs can run at most once a day.
- Business name is always "Hup Up Attractions".
- Before pushing: `npm run typecheck` and `npm test`.
