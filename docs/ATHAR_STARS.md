# Athar: paying with Telegram Stars (phase A)

Built from `docs/FOR_ATHAR_CREATOR_REVIEW_stars_payments.md`. **Off by default.** Nothing changes for users until `ATHAR_ENABLE_STARS=1` is set on Vercel. It does not touch the contracts, the crypto payment path or any existing table.

Scope: kinds `normal`, `silver`, `gold` only. Flow: `/stars` (or the ⭐ button) -> date (reply) -> kind (buttons) -> receiving TON address (reply) -> Stars invoice -> paid -> owner queue -> the owner signs `AdminMint` in the Athar admin panel -> the buyer is told.

## Code
- `src/lib/atharStars.ts`: tables (`athar_star_orders`, `athar_date_locks`, created on first use), prices, date lock, order creation, pre-checkout decision, successful payment (idempotent on `telegram_payment_charge_id`), refund, queue, sweep.
- `src/lib/atharStarsBot.ts`: the bot conversation and messages (English and Arabic; other languages see English).
- `src/app/api/telegram/[botId]/route.ts`: Athar's `pre_checkout_query` is checked (order open, same buyer, same amount, lock held, date free on chain) instead of approved blindly; other bots unchanged.
- `src/app/api/cron/athar-stars` + `.github/workflows/athar-stars.yml` (every 5 minutes): expire unpaid orders after 15 minutes, close minted ones and tell the buyer, refund orders unminted after 7 days or paid after expiry.
- `src/app/admin-tools/athar-stars` + `/api/admin/athar-stars`: owner queue (claim for signing, retry, refund). The claim is atomic and refuses a token already on the chain. «تجهيز للسك» opens the Athar admin URL with `?mint=<kind>:<date>:<address>`, which `AdminPanel.tsx` uses to pre-fill the owner-mint form; the owner still signs.
- Tests: `src/lib/__tests__/atharStars.test.ts` (prices, dates, address, every pre-checkout refusal, chain check never guesses, flag off hides everything).

## To switch on (owner)
1. Set `ATHAR_STARS_PRICES` (for example `250,750,2000` = normal, silver, gold; defaults are those numbers, a proposal only) and `ATHAR_ENABLE_STARS=1`, redeploy.
2. Put the Athar admin URL once into the queue page (kept in the browser only).
3. Test with one small order first.

## Known limits
- The mint is manual: delivery takes as long as the owner takes to sign. The buyer is told "usually within a day".
- The crypto path does not yet read `athar_date_locks`, so a date being paid for with Stars can still be bought with crypto; the Stars side re-checks the chain at pre-checkout and the owner re-checks before signing, and a loser is refunded. Making the crypto path read the lock is the remaining step.
- An order is closed as minted when the chain shows that kind of that date taken after the owner claimed it.
- Not externally audited; Telegram's rules on selling on-chain items for Stars should be read by the owner before switching on.
