# Engagement features (Palmyra Launch)

What brings people back, without moving money:

- **Journey** (`/zenobia/journey.html`, `znbt/journey.js`, `ZJ` in `nav.js`): daily streak, one-time quests, ranks. Points are a progress score kept in the browser (localStorage `znbt-journey-v1`); not money, not a token, nothing promised.
- **Reactions** (⭐🔥💔) on the coin page: `POST/GET /api/zenobia/react`, table `znbt_reactions` (one vote per kind per Telegram user, or per address hash outside Telegram).
- **Alerts**: opt-in per coin (`near` 90% to graduation, `grad`, `move` ±20%), table `znbt_alerts`, API `/api/zenobia/alerts` (needs Telegram initData). Sent by the platform bot from `runAlerts()` after every index refresh (`znbtIndex.refreshSnapshot`), max 5 messages per user per run, blocked users are dropped.
- **Invites**: `https://t.me/PalmyraLaunchBot?start=ref_<id>`; the bot records the invitee (`znbt_referrals`) and `/api/zenobia/ref` returns the count. Counting only; paying a share of fees is the owner's decision and is not implemented.
- **Athar passport**: the portfolio shows the Athar day-tokens a wallet holds (public chain data via tonapi).
- **Feel**: haptics, prefetch of the next page, shell kept still during page transitions, pull-down to refresh, exit confirmation on Back.
