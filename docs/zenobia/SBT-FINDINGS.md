# Caravan Passport (SBT): what the reference code allows (read 2026-10-12)

Sources read: TEP-85 text (ton-blockchain/TEPs) and `sbt-item.fc`, `nft-collection-editable.fc` from getgems-io/nft-contracts.

| Question | Answer from the code |
|---|---|
| Can the item be transferred? | No. `op::transfer` does `throw(413)`. |
| Can the holder burn it? | Yes. `op::destroy` (owner only) sets owner and authority to null. A burned passport is detectable: `get_nft_data()` returns a null owner. |
| Can the issuer revoke it? | Yes, if an authority address was set at mint. Sets `revoked_at`. We can mint with no authority. |
| Can the item's own content be edited? | No edit op on the item. Its content cell is fixed at mint. |
| Can the picture and text change without a new contract? | Yes. The collection's `get_nft_content` returns common-content URL + the item's individual content. Keep the URL fixed and change the JSON we serve at it (stage, image, title). |
| Can the base URL itself change? | Yes, in the editable collection: `op 4` changes collection content, `op 3` changes owner (both owner only). |
| Does the issuer need to hold funds in it? | No. The collection only needs a small storage balance. |

Still unverified (needs a real test): whether Tonkeeper and other wallets show SBTs in the NFT tab and refresh a changed image (wallets cached stale Athar metadata). Deployment cost per passport (~0.03-0.05 TON, measured earlier) to be re-measured on testnet, then one real passport.

Plan: compile with the reference sources, rehearse on testnet (free), mint one real passport, check wallets/explorers, only then open to the public.
