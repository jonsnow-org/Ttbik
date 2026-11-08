# Vercel usage: how to find what burns the free plan, and what was done (2026-11-08)

Symptom: `https://ttbik.vercel.app` answers **HTTP 402** (the free "Hobby" plan's fair-use limit was exceeded). The gate keeps the site alive from Oracle; Vercel is the standby.

## 1. How to find the cause (3 steps, 5 minutes)
1. **Vercel → team → Usage** (the page lists every meter with a bar). The meters and what drives each:
   | Meter (Hobby limit) | What fills it here |
   |---|---|
   | Deployments per day (100) and Build minutes (6000/month) | every push to the production branch builds the site (`git log`/`gh api repos/jonsnow-org/ttbik/deployments` count them) |
   | Function invocations (1M/month), Function duration GB-hours (100/month) | Telegram webhooks of the 15 bots (60 s legs for media/Nova), cron calls, supervisor probes |
   | Fast Data Transfer (100 GB/month), Edge requests (1M/month) | page/asset downloads: promo links, crawlers, `public/zenobia` (31 MB: 7 JS bundles of 1.1 MB, 6 videos) |
2. **Count deployments per day** (this is how the cause below was found):
   `for p in 1 2 3; do gh api "repos/jonsnow-org/ttbik/deployments?per_page=100&page=$p" -q '.[]|[.environment,.created_at[0:10]]|@tsv'; done | sort | uniq -c`
3. **List what calls Vercel directly** instead of the gate (the gate sends to Oracle first):
   `grep -rnE "vercelUrl|vercel\.app" .github/workflows scripts/supervisors scripts/promo`

## 2. What the numbers said
- **Builds were the dominant driver.** Production deployments per day: 10-29: 91, 10-30: 82, 11-01: 44, **11-02: 108 (+4 previews: over the 100/day cap)**, 11-03: 65, 11-04: 50, then 21, 9, 3. The production branch gets 27-236 commits a day (Sham training, Nova work, daily news) and each one built.
- **Why:** commit `c1d6e302` (2026-10-27) removed `"ignoreCommand"` from `vercel.json`, so `scripts/vercel-ignore.sh` (even after its 2026-11-01 update "fewer needless builds") was dead code.
- **Monitoring bots are not the cause.** GitHub supervisors: about 16 requests/hour straight to Vercel (about 11,500 a month = 1% of the 1M edge requests) plus one hourly `bots-health` function (30 Telegram calls). The `*/5` workflows (athar-mints, athar-stars, znbt-index) and `*/15` zenobia-watch go through the gate (Oracle) and only land on Vercel when Oracle is down. One real leak: `coder-schedules.yml` called Vercel directly every 5 minutes (288 a day).
- **Promotion:** channel posts (8 a day) and coins posts (3 a day) call the site through the gate. The posts and the site's canonical address (`SITE_URL` in `src/lib/siteUrl.ts`, `deploy/hosting/site.json` -> `canonicalUrl`) still link to `ttbik.vercel.app`, so every visitor, crawler and promo click lands on Vercel, not Oracle. That is the next lever for bandwidth/edge requests (owner decision: change `NEXT_PUBLIC_CANONICAL_URL` to the gate address).

## 3. What was changed
1. `vercel.json`: `ignoreCommand` is back (`sh scripts/vercel-ignore.sh`).
2. `scripts/vercel-ignore.sh`: more excluded folders (`.openhands/`, `scripts/{ops,tests,transplant,nova-eval}/`, `hosting/`, `muse-spark/`) and a **60-minute throttle**: a site commit builds only if the last deployed commit is at least 60 minutes older, or the message contains `[deploy]` (or `[vercel]`), or it touches `vercel.json`, `package*.json`, `next.config.mjs`, `prisma/schema.prisma`. Merge commits and previews behave as before. Tests: `scripts/tests/vercel-ignore.test.mjs`.
3. `coder-schedules.yml` now calls the gate, not Vercel.

Consequence to know: the last commit of a burst may not be deployed to Vercel until the next site commit after the window (daily news commits give one every few hours). Oracle is not affected. Put `[deploy]` in a commit message to force a Vercel build.

## 4. If it happens again
Open Usage, find the meter at 100%, then use the table in section 1. Do not set the gate to "Vercel only" while Vercel answers 402; keep it on "auto".
