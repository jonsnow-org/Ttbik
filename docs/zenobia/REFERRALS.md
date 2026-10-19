# Invite rewards

- Inviter gets **20% of the platform fee** (the 1.5%, not the trade) on the invitee's **buys** of platform coins, for **180 days** after the invitee linked their wallet. Constants: `src/lib/znbtRefs.ts`.
- The invitee joins through `https://t.me/PalmyraLaunchBot?start=ref_<id>` (recorded in `znbt_referrals`) and links a wallet on the Journey page (TonConnect ton_proof bound to the Telegram account, `znbt_wallets`).
- The hourly workflow `referral-sync` calls `/api/cron/referral-sync`: it reads each linked invitee's recent events from tonapi, finds buys on platform curves (bounced buys and sells are not counted), and writes credits into `znbt_ref_events` (idempotent by event id).
- The Journey page shows the credited balance.
- **Payout wallet** (`src/lib/znbtPayout.ts`, owner order 2026-10-19): a separate V4 hot wallet created on the owner's first `/referrals`; its words are encrypted (AES-256-GCM, key derived from the platform bot token) in `znbt_ref_state` and never printed. The owner funds it by sending GRAM to the address `/referrals` shows. **Do not rotate the platform bot token while it holds funds** (use `/referrals withdraw ADDRESS` first).
- Owner bot commands: `/referrals` (log: wallet, balance, totals, who is due, latest payouts), `on` / `off` (automatic payouts from the hourly sync; default OFF), `pay` (pay what is due now), `withdraw ADDRESS` (everything back out), `resolve sent|failed` (after checking an unconfirmed payout).
- Limits: minimum 0.25 GRAM per payout, 20 GRAM per inviter and 50 GRAM overall per 24h, 0.1 GRAM always kept, max 3 payouts per run. A payout row is written before sending; an unconfirmed one stops all payouts until resolved.
- Measured, not guaranteed: tonapi event shapes were modelled from its documentation and fixtures (unit tests); check the first real credits against the chain before enabling any payout.
