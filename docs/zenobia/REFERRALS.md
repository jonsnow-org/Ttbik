# Invite rewards (accounting only for now)

- Inviter gets **20% of the platform fee** (the 1.5%, not the trade) on the invitee's **buys** of platform coins, for **180 days** after the invitee linked their wallet. Constants: `src/lib/znbtRefs.ts`.
- The invitee joins through `https://t.me/PalmyraLaunchBot?start=ref_<id>` (recorded in `znbt_referrals`) and links a wallet on the Journey page (TonConnect ton_proof bound to the Telegram account, `znbt_wallets`).
- The hourly workflow `referral-sync` calls `/api/cron/referral-sync`: it reads each linked invitee's recent events from tonapi, finds buys on platform curves (bounced buys and sells are not counted), and writes credits into `znbt_ref_events` (idempotent by event id).
- The Journey page shows credited balance. **No money is sent by this code.** Payout to wallets is not implemented/enabled: it needs a funded payout wallet and the owner's go-ahead (see the session notes).
- Measured, not guaranteed: tonapi event shapes were modelled from its documentation and fixtures (unit tests); check the first real credits against the chain before enabling any payout.
