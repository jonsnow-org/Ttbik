# Palmyra Launch: trading features (research and status, 2026-10-19)

Research sources: STON.fi docs (Omniston referral fees, DEX v2 SDK swap), DeDust docs and announcement (referral program closed 2025-01-01), Getgems help centre and `getgems-io/nft-contracts`.

## Built now (non-custodial, no new contracts)
- **Swap tab** (`public/zenobia/swap.html`, `contracts/zenobia-curve/web/src/swap.ts`): TON / USDT / STON and any token with a STON.fi DEX v2 pool.
  The wallet signs the swap; nothing is held by the platform. A 0.30% platform fee (`REF_BPS = 30`; STON.fi v2 allows 0.01% to 1%) is attached as STON.fi's referral fee.
  The quote shows the total (pool fee + platform fee) before the user confirms. Unverified tokens carry a warning (anyone can mint a token named "USDT").
- **Earnings page**: a "Swap fees" card appears for any wallet that has accrued referral fees; one confirmation per vault withdraws them (STON.fi vaults, `getWithdrawFeeTxParams`).
- Coins that graduated link to DeDust from the trade page.

## Facts found
- STON.fi DEX v1: referral fee fixed at 0.1%, paid inside the swap. DEX v2: 0.01% to 1%, accrues in a vault per (token, referrer), claimed by the referrer.
- DeDust shut its built-in referral revenue sharing on 2025-01-01; an integrator needs its own fee contract (or Omniston's fee-vault route). So swaps of coins that graduated to DeDust earn nothing today.
- Our curve graduates to DeDust, while the Swap tab quotes STON.fi pools only. Next step if wanted: Omniston (aggregates STON.fi + DeDust + others with a referrer fee of 0.01% to 1%).
- Getgems takes 5% on NFT sales; its sale contracts (`nft-fixprice-sale-v3r3`, `v4r1`) are open source in `getgems-io/nft-contracts`. Whether they accept a jetton as the price was not found in the docs read.
- There is no native BTC on TON, only wrapped copies with thin liquidity; the practical major coins on TON are TON, USDT and STON.
- Blum's exact fees and custody model were not found in public sources; no figure is claimed.

## Not built, and why
- **User coins against major coins on our own curve**: needs a changed, unaudited mainnet contract. A pool on a DEX after graduation does this without touching our contracts.
- **Our own NFT marketplace with a fee / NFT for user coins**: new contracts handling real money; needs an audit and the owner's explicit order.
- **Automatic trading bots**: a bot that trades for users must hold keys (custody) or use on-chain order contracts. Custody is a legal and security liability (licensing differs by country; a decision for the owner and a lawyer). A safe next step is non-custodial limit orders or DCA via on-chain contracts, no profit claims.
- No profit is promised anywhere in the product.
