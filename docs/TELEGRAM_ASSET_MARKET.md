# Telegram Asset Market / سوق ملكية أصول تيليجرام

This feature adds channel, group and bot ownership sales to the existing channel-exchange Mini App. It is separate from advertising-placement deals.

## Identity model
- Telegram numeric user ID is the canonical key.
- First name, last name and username are captured from Telegram-signed Mini App initData and stored as transaction snapshots.
- Phone numbers are accepted only when the sender shares their own Telegram contact and `contact.user_id` exactly matches the sender ID.
- Public listing cards expose the seller's display name and username only. Telegram ID and phone are visible only to the account owner, the two parties to the sale, and the platform owner.

## Verifiers
Both configured verifier bots are checked in parallel: the builder owner bot and the independent site owner bot. Either one can prove ownership if it is an administrator in the target chat; the exact available usernames are displayed in the Mini App. If only one is configured or accessible, that single bot can verify. For a channel or group, one verifier bot must be an administrator, the seller must be returned as `creator` before listing, and the buyer must be returned as `creator` after transfer. Private chats can be checked by supplying their chat ID after adding the verifier bot.

A bot's BotFather owner cannot be reliably queried through Telegram's public Bot API. Bot sales are therefore held for manual BotFather review: the seller reports the transfer, the buyer confirms receipt, and the platform owner records an explicit review reference. No sale is marked verified before that review.

## Pricing\n- Minimum listing price is $10, with no fixed upper cap in the application.\n- Asset-market commission is currently 0%; the seller receives the full listed price. Do not enable a fee or change the price limit without the owner setting those terms.\n\n## Sale lifecycle
1. The seller's identity and phone are checked; the channel/group ownership is checked by Telegram where supported.
2. The listing is reserved for one buyer for 30 minutes while awaiting payment.
   A payment arriving after expiry is flagged for owner refund review; it never re-opens transfer or unlocks a newer buyer reservation.
3. A `CHM-` sale code is passed through the existing Stars / NOWPayments / USDT payment path.
4. The seller reports transfer; the buyer confirms. Channel/group transfers are verified through `getChatMember` and the buyer's Telegram ID.
5. Bot transfers need both party confirmations and owner review.
6. The owner pays the seller manually and records the settlement reference. Refunds are blocked after verified ownership transfer.

## Safety / operational limits
- Never request Telegram login codes, passwords, two-step verification passwords, bot tokens, or session files.
- Public statistics are not treated as proof of ownership.
- No funds are released solely because one party clicks a button.
- Verification bots need admin access to each channel/group; no admin access means no automated ownership result.
- This is an identity and escrow workflow, not a guarantee against off-platform disputes or external legal restrictions.

## Database
Run `prisma/migration_44_telegram_asset_market.sql` in the Supabase SQL editor before enabling the feature. The server also uses idempotent first-use DDL as a compatibility guard. New identity/listing/sale tables have RLS enabled and direct anon/authenticated grants revoked.
