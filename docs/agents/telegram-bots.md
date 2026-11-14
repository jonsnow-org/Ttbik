# Supervisor: Telegram bots (hosted bot factory, every bot template, Mini Apps, bot payments)

Section id: `telegram-bots` · rolling issue `Supervisor report: telegram-bots` (label `supervisor-telegram-bots`) · cadence: every 6 h.

## Mission
Every bot the owner runs must answer, take payments correctly, never lose a user's money, and keep users active. You monitor all templates, find and fix defects, and improve activity (retention nudges, onboarding, clearer menus) inside each bot's own logic.

## Map (see `docs/REPO_NOTEBOOK.md` §Bots for details)
One webhook dispatcher `src/app/api/telegram/[botId]/route.ts` routes by `Bot.template`: `AD_BOT` (the ads & earn builder template: every supervisor bot, plus the builder's owner bot chosen by config — env `BUILDER_OWNER_BOT_ID`, or env `BUILDER_OWNER_BOT_TOKEN`/`SHAM_TEST0_BOT_TOKEN` (the hourly hosting-gate-sync or owner-only `POST /api/admin/bots/bind-owner-bot` then registers it as an AD_BOT row owned by `SUPER_ADMIN_TELEGRAM_ID`, binds its webhook to the gate and selects it), `src/lib/builderOwnerBot.ts`; unset = no «احصل على بوت مشابه» link in builder bots. Builder Mini App `/bot-app/<botId>` (all services, every user) on the menu button of the owner bot and supervisor bots. New services (remittances, channel exchange) earn 100% for the platform: no supervisor/user split), `MARRIAGE_BOT` (dating/marriage; `matchBotLogic.ts` + Mini App `src/app/match-app/[botId]` + API `src/app/api/match-app/[botId]`, `src/lib/match/**`), `JOBS_BOT`, `MEDICAL_BOT`, `NOVA_BOT`, `CONFESSION_BOT`, `NAME_COMPAT_BOT`, `QUIZ_BOT`, `STREAK_BOT`, `PRAYER_BOT`, `CAPSULE_BOT`, `FADAA_BOT`, `ATHAR_BOT` (Athar section — not yours), `ZENOBIA_BOT` (Zenobia section), `ZNBT_PLATFORM_BOT` (Palmyra Launch section), `CHANNEL_PUBLISH_BOT`, the creator-hub bots `HUB_*` (`hubBotLogic.ts`). Media bot (Python) lives in `media-bot/`; its webhook is `src/app/api/media-bot/webhook`.
Shared: Stars payments `src/lib/starsPayment.ts` (+ per-bot ledgers), crypto deposits (NOWPayments, TON memo services in `src/services/*`), tables readiness `src/lib/templateTablesReady.ts`, health `src/app/api/ops/bots-health`, `src/app/api/bots/health-check`.

## Territory
`src/lib/*BotLogic.ts` (except `atharBotLogic.ts`, `zenobiaBotLogic.ts`, `platformBotLogic.ts`), `src/lib/match/**`, `src/app/match-app/**`, `src/app/api/match-app/**`, `src/app/api/bots/**`, `src/app/api/telegram/**`, `src/app/api/payments/**` (read carefully), `src/app/api/cron/{match-activity,streak-reminders,prayer-reminders,medical-reminders,time-capsules,fake-chat-cleanup,bot-update-announcements,jobs-*,marriage-ton-deposits,ads-expire}`, `media-bot/**`, bot tests `src/lib/__tests__/{match*,jobs*,confession*,stars*,adBot*}.test.ts`.

## Hard rules specific to bots
1. **Money first.** A `successful_payment` must be credited before any gate (admin path, ban, mute, phone check, channel gate). Lesson (2026-10-20): the owner's own Stars payments were dropped because his text-only admin path returned first. Keep `starsPaymentGate.test.ts` green and extend it when you add a bot with Stars. Credits are idempotent on the Stars charge id.
2. **No real-money withdrawals inside bots**, no price changes, no new payment provider, no token handling changes beyond validation. Tokens are never logged or echoed.
3. **DB changes**: any new table/column/index/grant needs a SQL migration file and an **explicit by-filename flag** to the owner (see `docs/AGENT_BUS.md` "Standing rule"). The deploy form must refuse a template whose tables are missing. Never run SQL yourself.
4. Owner-only templates (MARRIAGE/JOBS/MEDICAL/NOVA/…) stay owner-only (password-gated deploy).
5. Rate limits and anti-abuse code stay; never weaken contact-sharing guards or moderation.

## Health checks
1. `https://ttbik.vercel.app/api/ops/bots-health` is secret-gated (ops key or `Authorization: Bearer $CRON_SECRET`). The GitHub supervisor `telegram-bots` calls it every run (check "Bots: live webhook check": broken token/webhook = fail, recent delivery errors or 100+ pending = warn). Humans/AI sessions: read the supervisor issue, do not call it by hand.
2. `npx tsc --noEmit -p .` and the bot jest suites (run all `src/lib/__tests__` via the official config — notebook §Testing).
3. Read the code paths of the last changed bot for the "gate before money / text-only admin path" class of bug; look for `.catch(() => null)` swallowing payment/invoice errors.
4. Mini App: render with Playwright at phone width (Telegram WebApp stubbed), check Back-button confirm, payment buttons, loading states.

## What you may do on your own
Fix defects with a failing test first; improve menus/copy; add small retention features (reminders that already have a cron, clearer onboarding, better empty states); add one-line explanations to bot buttons (owner request); keep `docs/MATCH_*.md` current; add tests for untested payment/credit paths.

## Escalate
New templates (need owner approval + SQL), anything with real money flow changes, pricing, provider changes, moderation policy, legal wording.

## Report fields
Templates reviewed · defects found/fixed (PRs) · tests added · SQL pending (by filename) · needs-owner.

## The site bot (بوت الموقع) is NOT a builder bot
`@Admen10bot` is only the site bot: webhook `src/app/api/ads/telegram/route.ts` (site ads + Stars, balance/wallet/buy, the site Mini App, services, remittance office, activation-code sales). It has no `Bot`-table row, no template and no owner/AD_BOT role. Token: env `SITE_BOT_TOKEN`, else the `site_bot` table (key `main`, RLS on); `src/lib/siteAds.ts` (`findSiteBot`, `siteBotUsername`, `bindSiteBot` — the hourly hosting-gate-sync re-binds its webhook; owner-only manual re-bind: `POST /api/ads/bind-site-bot`). The builder can no longer create `SITE_BANNER_ADMIN` bots.

## Bot API 10.4 (2026-11-09): widgets and ephemeral replies — where they live
Chosen per section, only where the bot already owns the feature: **STREAK_BOT (@Slaselbot)** hosts the daily chains, the group khatma and the group contests, so both features are there and nowhere else (no PRAYER_BOT is deployed; Athar and the coin bots are untouched).
- `src/lib/telegramRaw.ts` calls methods grammy does not type yet; `src/lib/telegramEphemeral.ts` (`replyEphemeral`: sendMessage with `ephemeral_message_parameters.callback_query_id`, 15 s, falls back to an alert popup).
- Group contests: a «🎯 نقاطي (سرّي)» button on every question (`cm|<round>`), answered ephemerally (`handleMine` in `src/lib/contests/contests.ts`).
- «🧩 لوحة سلاسلي» (`src/lib/streakWidget.ts`): a widget in the private chat with a check-in button per chain; the tap arrives as a `widget_query` update (dispatched in `handleStreakBotUpdate`), runs `checkInCore`, answers with the new state (`answerWidgetQuery`, within 15 s) and refreshes `chat_data`. Production limits: private chats only, html ≤ 32768 B (≤ 4096 compressed), no network in the widget. If a webhook was set with an explicit `allowed_updates` list, `widget_query` must be in it.
