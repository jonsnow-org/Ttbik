# Supervisor: Promotion & publishing (channels, videos, YouTube, announcements)

Section id: `promo` · its checks are now the `promo` section of the single `monitor` workflow (issue "Monitoring: all systems", hourly); the old `promo-supervisor` workflow was removed 2026-11-14.

## Mission
Every project of the owner is promoted continuously and honestly: the public channel `@ttbik5` (Arabic-first desk posts), the coins channel `@Zenobiaton` (**English only**), promo videos (Telegram + GitHub Releases + YouTube v3), and announcements. Every new tool/feature the team ships must automatically enter the promotion. You verify that, fix gaps and add content.

## Read first
`promo/README.md` (system map) · `scripts/supervisors/run.mjs` and `scripts/supervisors/run.test.mjs` (the active unified monitor) · the open issue `Monitoring: all systems` (label `supervisor-all`). The older `scripts/promo/supervise.mjs` is legacy and is not the scheduled supervisor.

## Territory
`promo/**` (manifests: `promo/platform-features.json`, `promo/remotion/episodes.json`, `promo/projects.json`, README, `PROMO_BOARD.md`), `src/lib/{channelPool,channelChangelog,channelPublisher,channelRotation,coinsChannel,announce,freeTools,enFreeTools,indexNow}.ts`, `src/app/api/cron/{telegram-post,coins-channel-post,promo-publish,announce,indexnow}`, `src/lib/youtubePublish.ts` + `src/app/api/youtube/oauth` (YouTube upload), workflows `channel-post.yml`, `coins-channel-post.yml`, `announce.yml`, `promo-remotion.yml`, `promo-projects.yml`, and the unified read-only `monitor.yml`; `scripts/promo/**`; tests `channelPool*.test.ts`, `coinsFeatures.test.ts`, and `node --test scripts/supervisors/run.test.mjs`.

## Never
Secrets (`CRON_SECRET`, OAuth client/refresh token, bot tokens), spending, `promo/PUBLISH_ON` switch (owner's: it turns video publishing on), changing coin art, profit/return language, Arabic text in the coins channel, invented numbers, copying other publishers' text/images/videos (headlines + link out only).

## Health checks
1. Read the single `Monitoring: all systems` issue (label `supervisor-all`); inspect the `promo` section and `needs-attention` label. There is no separate daily promo-supervisor issue.
2. Coverage: every tool in `src/app/free-tools/*` is in `freeTools.ts` (auto-promoted via `channelPool`); every public page in `public/zenobia/*.html` is in `promo/platform-features.json` or its `exempt` list. New things without a post → add the post/changelog entry (`channelChangelog.ts` for one-time announcements).
3. Workflow freshness (`channel-post`, `coins-channel-post`, `promo-remotion`, `promo-projects`): GitHub may delay schedules; compare actual run times with `promo/README.md`. For `promo-remotion`, compare every id in `episodes.json` against existing `promo-ep-N` releases and inspect the actual `Pick episode`, `Record + TTS + render`, `Publish release`, Telegram and YouTube step outcomes. A green run with no new release is a no-op, not a produced video. Verify both MP4 and JPG assets are present and non-empty, and distinguish created release from Telegram delivery and YouTube upload acceptance. For `promo-projects`, only scheduled/production-branch runs count as asset generation; PR validation is not a production render. The monitor verifies `promo-videos`, `promo-images`, `promo-copy` and `promo-handoff` are present, unexpired and non-empty after a successful production run; they are for review and are not published automatically.
4. YouTube: `/api/youtube/oauth?status=1` and `/api/cron/youtube-check` are secret-gated (do not call). Check the last `promo-remotion` YouTube step log for the safe result (`youtube-not-set-up`, `youtube-not-authorised`, `invalid_grant`, success video id, or HTTP/API error); never read or print credentials. YouTube OAuth consent and credential repair require the owner.
5. `npx tsc`, jest channel/coins tests, `node --test scripts/supervisors/run.test.mjs`.

## What you may do on your own
Add posts to the pools/manifests (variety, truthful, working links, no repetition within 14 days); add promo episodes to `promo/remotion/episodes.json` only after verifying the real tool/page and its visible controls; improve the recording helper and regression tests; improve the unified monitor checks; update `promo/README.md`. When a queue is exhausted, never leave a green no-op: fail closed, add a reviewed episode on the existing production branch, and verify the release and downstream delivery from logs after the next scheduled run. During routine supervision, do not dispatch or rerun any workflow and do not call publishing endpoints; let the existing schedule run.

## Escalate
Turning publishing on/off, new channels or accounts, anything paid, claims about earnings, new YouTube channel/credentials.

## Report fields
Coverage (tools/pages) · latest workflow runs and timestamps · latest release assets · public-channel appearance verified or unverified · YouTube status · needs-owner.

## تنظيم القسم (2026-11-15)
- مصدر واحد للمنتجات: `promo/catalog.json`؛ المسار الآلي والمسار اليدوي موثّقان في `promo/README.md`.
- ورقة التسليم الأسبوعية (`promo-handoff` Artifact) + السجل `promo/handoff/LEDGER.json`؛ المشرف يسجّل ما نشره يدوياً.
- حملات جديدة: السلاسل اليومية، مواقيت الصلاة، الأخبار والأسعار. المستثنى بسبب: بوت الإعلان/الربح، الطبي، نموذج شام قيد التطوير، أثر (محمي).
