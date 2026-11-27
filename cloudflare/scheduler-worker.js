/**
 * Free scheduler for Hup Up Attractions (Cloudflare Workers, free plan, no card needed). Nov 15, 2026.
 *
 * Every 5 minutes it calls the website's short jobs: /api/cron/frequent (release ended holds, voicemail alert safety net,
 * held promotional texts, address re-checks). The site runs the regular jobs every 3 hours whatever the schedule (Neon
 * free plan, Nov 26, 2026) and sooner only when a small R2 wake flag says so (Nov 27, 2026). Vercel's free plan can
 * only run its own scheduler once a day.
 *
 * Worker settings (set by cloudflare/wrangler.scheduler.toml, plus one secret):
 *   SITE_URL      https://hupupattractions.com   (plain text, in the toml file)
 *   CRON_SECRET   the same value as CRON_SECRET in Vercel   (secret: wrangler secret put CRON_SECRET)
 *
 * The Worker itself uses no storage and no DNS (the site reads its R2 wake flags).
 */
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runJobs(env));
  },
  // Opening the Worker's own address shows only whether it is set up; it never runs the jobs.
  async fetch(request, env) {
    return new Response(env.SITE_URL && env.CRON_SECRET ? "Hup Up Attractions scheduler: set up." : "Hup Up Attractions scheduler: missing SITE_URL or CRON_SECRET.", { headers: { "content-type": "text/plain" } });
  },
};

async function runJobs(env) {
  if (!env.SITE_URL || !env.CRON_SECRET) {
    console.log("scheduler: SITE_URL or CRON_SECRET is missing");
    return;
  }
  const url = `${env.SITE_URL.replace(/\/$/, "")}/api/cron/frequent`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
      console.log(`scheduler: ${res.status} ${(await res.text()).slice(0, 300)}`);
      if (res.ok) return;
    } catch (e) {
      console.log(`scheduler: try ${attempt} failed: ${e}`);
    }
  }
}
