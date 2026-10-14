# Match mini-app — local QA pass (2026-10-14)

Environment: `bash scripts/qa/env.sh up` (local Postgres :54329, fake Telegram API :54400 via
`scripts/qa/intercept.cjs`, `next start` :3100, seeded fake users). Never touches prod DB or the real token.
Spec: `e2e/match-app.spec.ts` (Playwright, 390x844, mocked `Telegram.WebApp`, signed initData,
simulated webhooks). NOT run in CI. Screenshots: `/workspace/qa/shots/`, captured issues: `/workspace/qa/issues.json`.

## Bugs

| # | Screen | Steps | Cause | Fix | Status |
|---|--------|-------|-------|-----|--------|
| 1 | Admin dashboard | Switch sections quickly (Overview → Reports) | Slower response of the previous section rendered under the new one (`r.reporter.name` of undefined → page crash) | Request sequence guard + data tagged with its section (`__sec`) | Fixed |
| 2 | Admin dashboard | Leave Overview | Section badges (pending counts) disappeared — they were read from the current section's data | Badges kept in their own state | Fixed |
| 3 | Anon chat | Two app users press 🔀 within ~1 s | App path has no search animation, so the first searcher falls back to an AI partner immediately (FAKE threshold 100) — real app users rarely meet each other | App (quiet) path now waits `appSearchWaitMs()` = the bot animation length (8 frames × 650 ms) after enqueueing; the client keeps polling; second pairing attempt + AI fallback only after that. Bot path untouched. | Fixed (round 2) |
| 5 | Anon filters purchase (bot + app) | Buy «🎛 فلاتر الدردشة» | `make_interval(days => $1)` received a bigint parameter → Postgres 42883; the balance was already charged, the filter never activated | Cast `${days}::int` (and `${minutes}::int` in the idle-session sweep, same error) | Fixed (round 2) |
| 6 | Anon idle sweep | Session idle > N min | Same bigint → `make_interval(mins)` error; idle sessions never auto-ended | `::int` cast | Fixed (round 2) |
| 7 | Tabs | Open «ملفي», tap any section pill, then «المطابقات» | `AnimatePresence mode="wait"` waited forever for the exiting tab → blank screen | Enter-only tab animation (no exit wait) | Fixed (round 3) |
| 4 | QA env | `env.sh up` never returned | Background processes inherited the pipe | `setsid … < /dev/null` | Fixed |

## Verified OK
Boot/outside-Telegram screen, all 4 tabs (+ admin tab only for admin), bad initData → 401, non-admin admin_* → 403,
AI interlocutor chat stays in the app (no bot pushes), exit-reason sheet, app ↔ bot user via webhook,
discovery swipes/like/super/proposal/match modal, chats tab + compliment, profile edit/criteria/privacy,
every upgrade, insufficient balance, Stars invoice (`openInvoice`), every admin section and action, inline query.

## Not tested
Real Telegram clients/devices, real Stars/TON/crypto payments, photo upload from device, Supabase realtime (off).
(Round 2: the full 15-message contact exchange + report/block between two real app users now passes.)

## Round 2 — growth & monetization (2026-10-14)
All server-side, on the bot's balance/entitlement system (no new money path):
- **⚡ Buy now with Stars** (`buy_stars`): invoice for the exact shortfall (payload `MATCH_BUY_<key>:<uid>`); the bot's `successful_payment` handler credits it (unique Stars charge id = idempotent) then runs the same `purchaseByKey` as the app/bot. Keys: boost, vip, visitors, filters, anonFilters.
- **🎁 First-purchase discount 20%**: once per user, only if the user never paid from balance; claimed in the same DB transaction as the charge (`match_first_discount`), so a failed charge never burns it. Upgrades only (not super like / rewind).
- **⏰ Renewal reminders** 2 days before VIP / anon-filter expiry, once per expiry date (`match_expiry_reminders`), from the existing minute sweeper.
- **📈 Funnel** (`match_funnel_events`): app_open → upgrades_view → purchase_attempt → purchase_insufficient → stars_invoice → stars_paid → purchase_success (+ rewind, reminder_sent); admin section «📈 التحويل».
- **💌 Who liked me**: already free in the bot (`showLikedBy`) → free in the app too (Chats tab).
- **↩️ Rewind** (new, $0.5, `PRICE_REWIND` in entitlementRules): skips are logged (bot «➡️ الملف التالي» and app ✖️); bot card button «↩️ السابق» and app button use the same `purchaseRewind` (pass popped atomically, put back if the balance is short).
- UX: first-run onboarding, ✓/✓✓ read receipts and "يكتب الآن…" (app↔app), useful empty states, in-app notifications (likes / matches / visitors).


## Round 3 — Athar promotion (flag `MATCH_ENABLE_ATHAR`, off by default) — see docs/MATCH_ATHAR.md
Bot «⭐ الترقيات والمزايا» now shows the first-purchase price (e.g. «$1.6 بدل $2») while eligible; both label variants are accepted.
Full e2e: 15/15 passed (QA env runs with the flag ON; unit test covers OFF + hide-on-failure).
