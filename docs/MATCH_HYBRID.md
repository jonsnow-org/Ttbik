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

### Innovation
- Daily spin: server-side `crypto.randomInt`, atomic once per day.
- Secret-admirer compliments: preset sentences only, 5 per day, one per target per day.
- Referral: 3 verified invites (phone verified, approved profile, not banned) give 7 days of VIP, claimable once.

### Schema changes (additive only)
`prisma/migration_match_app.sql`: `match_app_messages`, `match_app_daily`, `match_app_passes`, `match_app_compliments`, `match_app_perks`. The app runs the same `CREATE TABLE IF NOT EXISTS` on first use. `schema.prisma` and the existing tables are unchanged.

### State management
- Client: plain React state per tab. `me` is reloaded after any action that changes limits. Polling uses `setInterval`, and its interval follows the chat state.
- Server: everything is stored in Postgres. In-memory rate limits apply per instance and are best-effort.
