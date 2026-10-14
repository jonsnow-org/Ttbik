# MARRIAGE_BOT (e.g. @Saragptbot): hybrid mode

Additive layer on `src/lib/matchBotLogic.ts`, same tables, same webhook (`/api/telegram/<botId>`), same state machine.

- Inline mode: `@Bot مصر 25-30 أنثى طبيبة` returns up to 20 results per page (`next_offset`) with `cache_time` 10 and `is_personal`. Only approved, visible, non-banned, non-blocked, 18+ profiles are returned. VIP-incognito and "my country only" profiles are excluded. Results contain no name, contact, photo or bio. Only phone-verified members with an approved profile can search. Code: `src/lib/match/inline.ts` (pure) and `src/lib/match/hybrid.ts`.
- Deep link `/start profile_<profileId>` opens a privacy-safe card with these buttons: anonymous chat request, like, report, block. The other side must accept within 24h, and the chat then runs on the existing random-chat relay.
- Mini App: `/match-app/<botId>` with the API at `/api/match-app/<botId>`. initData is verified with that bot's stored token. On every `/start` the bot sets the chat menu button to the Mini App. Set `MATCH_MINIAPP_MENU=0` to turn this off.
- Webhook: `setWebhook` does not pass `allowed_updates`, so Telegram's default already delivers `inline_query`. No change is needed.

Owner steps:
1. In BotFather, run `/setinline` and give a placeholder such as `دولة، عمر، جنس…`.
2. Optionally run `/setinlinefeedback`.
3. Optionally set a menu button with URL `https://ttbik.vercel.app/match-app/<botId>`.

## Premium Mini App (v2, 2026-10-14)

### Architecture
- UI: `src/app/match-app/[botId]/MatchMiniApp.tsx`. It is a client component built with Tailwind and framer-motion, dark navy with rose-gold and neon-pink glass, RTL. It uses the Telegram MainButton, BackButton and haptics.
- It has four tabs in a floating bottom nav: 🔀 دردشة مجهولة, 🔥 المطابقات, 💬 محادثاتي, 👤 ملفي.
- API: one POST endpoint, `src/app/api/match-app/[botId]/route.ts`, selected by `action`. Every call is checked with `verifyInitData` against that bot's token. A per-user rate limit applies, plus a limit per feature.
- Server logic:
  - `src/lib/match/premium.ts` (pure, tested): compatibility, spin wheel, referral, reveal consent, filters, compliments.
  - `src/lib/match/anon.ts`: anonymous chat on the bot's own tables.
  - `src/lib/match/appStore.ts`: the new tables.

### Anonymous chat (shared with the bot)
- It uses the same `RandomChatQueue` / `RandomChatSession` / `pendingAction` (`random_waiting` → `random_chatting`) as `matchBotLogic.ts`, so app users and bot users match each other.
- App filters (gender, country, age) apply only to candidates that have a profile. Fake bots are never used from the app.
- Sending: the app message goes to the partner through `bot.api.sendMessage` and is stored in `match_app_messages`. The bot relay (`random_chatting`) also stores each message (one added line, `recordAnonMessage`).
- The app polls every 2–2.5 s and only while it is visible. No paid realtime service is used.
- Reveal uses the existing `contactRequestedBy` column and `revealContacts()`, so contacts are exchanged only with mutual consent. Before that, the app blocks phone numbers and handles in messages.
- Skip / next uses `endRandomChat()` and then starts a new search. Report and block reuse `MatchReport` and `MatchBlock`.
- The ice-breaker uses `hubGenerate` (Sham, then Groq), with preset questions as the fallback.

### Discovery and swipe
- Candidates come from `availableProfiles` (approved, visible, not blocked, 18+). Ones already liked or passed in the last 7 days are excluded.
- Sorting: boosted/VIP first, then by "توافق تقديري", a deterministic `compatibilityScore`: 70% fit to my criteria, 30% my fit to theirs.
- Likes use the existing `MatchLike`. A super like is a like with a note. A mutual like triggers the existing `notifyMutualLike()`, which sends a Telegram alert to both, and the app shows the "إنه توافق" modal.
- 💍 sends a proposal request through `sendChatRequest(kind:"proposal")`, and the other side must accept.
- A real photo appears only when `MatchPhotoPermission` is GRANTED. The server proxies it as a data URL, so the token never reaches the browser.

### Innovation (superseded by v3: spin and referral VIP removed)
- Daily spin: server-side `crypto.randomInt`, atomic once per day.
- Secret-admirer compliments: preset sentences only, 5 per day, one per target per day.
- Referral: 3 verified invites (phone verified, approved profile, not banned) give 7 days of VIP, claimable once.

### Schema changes (additive only)
`prisma/migration_match_app.sql`: `match_app_messages`, `match_app_daily`, `match_app_passes`, `match_app_compliments`, `match_app_perks`. The app runs the same `CREATE TABLE IF NOT EXISTS` on first use. `schema.prisma` and the existing tables are unchanged.

### State management
- Client: plain React state per tab. `me` is reloaded after any action that changes limits. Polling uses `setInterval`, and its interval follows the chat state.
- Server: everything is stored in Postgres. In-memory rate limits apply per instance and are best-effort.

## v3: one system with the bot (2026-10-14)

### The bot's paid system (unchanged), now shared
- **Single source:** `src/lib/match/entitlementRules.ts` holds the prices and checks, and `src/lib/match/entitlements.ts` holds the purchase steps. Both the bot and the app call them.
- **Wallet:** `MatchUser.balance` (USD). Every charge is atomic and logs a `MatchTransaction`.
- **Top-up** (three ways, all crediting `balance`):
  - Telegram Stars, 100 stars per $1, in tiers of 100, 300, 500, 1000 or 2000. The invoice payload is `MATCH_DEPOSIT:<uid>`, and the bot's `successful_payment` handler credits it.
  - NOWPayments, through `/pay/marriage?uid=`.
  - Native TON/USDT with a memo.
- **Features:**

| Feature | Price | Duration | DB field |
|---|---|---|---|
| Boost | $2 | 24 h | `boostedUntil`; VIP already includes it |
| Verification | $3 | one-time | charged when the ID photo is sent in the bot; admin approves (`verificationStatus`) |
| Extra photos | $2 | permanent | `extraPhotosUnlocked` |
| Who viewed me | $2 | permanent | `profileVisitorsUnlocked` |
| Advanced filters | $2 | permanent | `advancedFiltersUnlocked`; adds city and marital status, plus «بحث دقيق» |
| Super Like | $1 each | per like | note stored on `MatchLike.note` |
| Gold VIP | $8 | 30 days, stacking | `vipUntil`; includes boost, filters, visitors, photos and incognito (`isIncognito`) |

- **Referral:** a 24 h boost for each invited friend whose profile goes live (`grantReferralReward`).

### App changes
- **Upgrade screen:** mirrors the bot's «⭐ الترقيات والمزايا». It buys through the same shared functions, uses the same Stars invoice through `createInvoiceLink` and `openInvoice`, the same payment link, and the same TON memo.
- **Verification and extra photos:** these set the same `pendingAction` (`verify_badge_photo` / `extra_photo_upload`), and the user finishes by sending the photo in the bot chat.
- **Matching:** uses the bot's own `buildSearchQueue` (normal and strict), `defaultPref`, `compatibilityPercent` (the bot's «💞 توافق X%») and `trackProfileVisit`.
- **Removed:** the spin wheel, referral VIP, free daily super likes and the anonymous-chat quota. Compliments remain because they grant nothing; they are rate-limited only.

## v4 — Anonymous chat = the bot's random chat + 🎛 paid filters (2026-10-14)
- The app's anon tab now calls the bot's own functions (startRandomChat, relayRandomChatText, endRandomChat + EXIT_REASON_LABELS, reportRandomChat, requestRandomChatContact). Same queue, 60s window (no auto-extension), 24h same-pair cooldown, mutual-block check, text-only relay, banned words, 📇 contact exchange after 15 messages with mutual consent, fake partners when the admin enables them (shown as "continue in the bot").
- Removed app inventions (code kept and marked REVIEW where shared): ⏭ next, ✨ icebreaker, partner age/country in chat header, phone/handle blocking in messages, reveal before 15 messages, queue auto-extension while the app is open.
- 🎛 Anon-chat filters: gender / country / age range. $2 per 30 days (stacks, no auto-renew), included in 👑 Gold. Table match_anon_filters (filter, paid_until, active_queue_id, notified_queue_id).
- Pairing (src/lib/match/anonRules.ts, anonPairOk): each side's ACTIVE filter must be satisfied by the other side's profile. A filter is active only for the queue row it was snapshotted on (active_queue_id set before the row is created) and only while still entitled — expiry mid-queue drops the filter, never charges.
- Queue claim is atomic (updateMany WAITING→MATCHED on the partner row and on our own row).
- Filtered users never get scripted fake partners. After the 60s window the fake-chat sweeper (every minute) sends "no match — widen?" with 🌐 once-without-filters / 🎛 edit buttons; also shown on the next press and in the app.
- Entry points: bot «⭐ الترقيات» → «🎛 فلاتر الدردشة العشوائية ($2/30 يوم)», «🎛 فلاتر الدردشة» in the in-chat menu, app Upgrade screen + anon tab.

## v5 — 🛡 Admin dashboard + reliability fixes (2026-10-14)
- Admin = the bot's exact check: `isMatchAdmin(id)` ⇔ id === SUPER_ADMIN_TELEGRAM_ID. `/api/match-app` re-checks it on EVERY `admin_*` call before any DB access (src/lib/match/adminApp.ts). The tab is shown only if the server says isAdmin.
- Mirrored (same functions as the bot buttons, Telegram alerts unchanged): stats, 🩺 diagnostics (sent to the bot chat), pending profiles approve/reject, ☑️ verification approve/reject (ID photo stays in Telegram), 🚩 reports (search / random) ignore / mute 24h / ban, 📥 inbox read / mute / ban / reply, 🔎 user lookup, 🔓 unban/unmute, 📢 broadcast. Badges = pending counts. No fake-bot toggle / settings / balance editing exist in the bot, so none were added.
- Audit log: match_admin_audit (bot + app + automatic actions).
- Fixes: atomic charge (conditional updateMany + ledger in one transaction); anon-filter extension via GREATEST(...) in one SQL; atomic 📇 request; contact guard (contactGuard.ts) in the bot relay (so bot + app); Postgres rate limiter (match_rate_limits) for charges/reports/requests/proposals/photo requests; idle random chats ended after 30 min (sweeper); auto-mute after 3 distinct reporters (30 days, until admin review) + admin alert; search animation / 2nd attempt / fake greeting moved to next/server after(); DDL run-once flag (match_app_schema); photo cache + Cache-Control; batched queue block/cooldown checks; recommended indexes in prisma/migration_match_app.sql (run manually).
- Realtime: optional content-free "doorbell" (empty ping on a per-session random topic, match_anon_rt) using the public anon key; client then polls the authenticated API. Polling stays as fallback with backoff 4s→12s (30s when live, paused when hidden). Disable with MATCH_REALTIME=off.
- REVIEW: `adminVia` is a module variable (audit "via" tag only) — concurrent requests on one instance could mislabel bot/app in the audit log.
