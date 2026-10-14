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
