# Silk Road Passport (transferable after 30 days)

`src/nft-item.fc` is TON Foundation's reference NFT item (MIT) with one change: the item stores `unlock_at = mint time + 30 days` and refuses transfers (exit 413) before it.
`src/nft-collection-editable.fc` is Getgems' editable collection (MIT, see LICENSE-getgems), unmodified; the collection is deployed with a 7% royalty.
`npm i && npm test` (needs @ton/sandbox, @ton-community/func-js) runs it in a local emulator: locked on day 0 and day 29, a stranger cannot move it, the owner can on day 30,
the new owner can pass it on or send it to the dead address, a later mint gets its own fresh lock, only the issuer can mint. No money, no network.
The compiled code used by the ledger is in `deploy/oracle/zenobia-ledger/contracts/silk-*.boc.b64`. Not deployed to any network yet.
