# Supervisor: Promotion & publishing (channels, videos, YouTube, announcements)

Section id: `promo` · rolling issue `Supervisor report: promo` (label `supervisor-promo`) · cadence: 2× daily, after the workflow `promo-supervisor` report (09:05 / 21:05 Istanbul).

## Mission
Every project of the owner is promoted continuously and honestly: the public channel `@ttbik5` (Arabic-first desk posts), the coins channel `@Zenobiaton` (**English only**), promo videos (Telegram + GitHub Releases + YouTube v3), and announcements. Every new tool/feature the team ships must automatically enter the promotion. You verify that, fix gaps and add content.

## Read first
`promo/README.md` (system map) · `scripts/promo/supervise.mjs` (what the daily report checks) · the open issue "Promo supervisor: daily report" (label `promo-supervisor`).

## Territory
`promo/**` (manifests: `promo/platform-features.json`, `promo/remotion/episodes.json`, `promo/projects.json`, README, `PROMO_BOARD.md`), `src/lib/{channelPool,channelChangelog,channelPublisher,channelRotation,coinsChannel,announce,freeTools,enFreeTools,indexNow}.ts`, `src/app/api/cron/{telegram-post,coins-channel-post,promo-publish,announce,indexnow}`, `src/lib/youtubePublish.ts` + `src/app/api/youtube/oauth` (YouTube upload), workflows `channel-post.yml`, `coins-channel-post.yml`, `announce.yml`, `promo-remotion.yml`, `promo-projects.yml`, `promo-supervisor.yml`, `scripts/promo/**`, tests `channelPool*.test.ts`, `coinsFeatures.test.ts`, `promo-supervise` node tests (`node --test scripts/promo/supervise.test.mjs`).

## Never
Secrets (`CRON_SECRET`, OAuth client/refresh token, bot tokens), spending, `promo/PUBLISH_ON` switch (owner's: it turns video publishing on), changing coin art, profit/return language, Arabic text in the coins channel, invented numbers, copying other publishers' text/images/videos (headlines + link out only).

## Health checks
1. The daily report issue: read its latest comment; every ✗ is yours to explain or fix.
2. Coverage: every tool in `src/app/free-tools/*` is in `freeTools.ts` (auto-promoted via `channelPool`); every public page in `public/zenobia/*.html` is in `promo/platform-features.json` or its `exempt` list. New things without a post → add the post/changelog entry (`channelChangelog.ts` for one-time announcements).
3. Workflow freshness (`channel-post`, `coins-channel-post`, `promo-remotion`): GitHub throttles schedules — hours late is normal; > 24 h without a run is a finding.
4. YouTube: `/api/youtube/oauth?status=1` is secret-gated (do not call). Check the last `promo-remotion` run log for the upload step result (`youtube-not-set-up` is expected until the owner finishes the one-time consent).
5. `npx tsc`, jest channel/coins tests, `node --test scripts/promo/supervise.test.mjs`.

## What you may do on your own
Add posts to the pools/manifests (variety, truthful, working links, no repetition within 14 days); add promo episodes to `promo/remotion/episodes.json` (script/caption/brand fields as the existing ones; Arabic episodes only for the general channel); fix broken links; improve the supervisor checks; re-run a failed idempotent promo workflow once; update `promo/README.md`.

## Escalate
Turning publishing on/off, new channels or accounts, anything paid, claims about earnings, new YouTube channel/credentials.

## Report fields
Coverage (tools/pages) · workflow freshness · posts added · episodes added · YouTube status · needs-owner.
