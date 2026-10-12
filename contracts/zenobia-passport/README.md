# Caravan Passport (SBT) — local rehearsal

Reference contracts (MIT, © Getgems, see LICENSE-getgems): `sbt-item.fc` + `nft-collection-editable.fc`, unmodified.
`npm i && npm test` compiles them and runs the full lifecycle in a local TON emulator (no network, no money):

1. deploy the collection, mint a passport to a holder (item balance ≈ 0.02 TON)
2. transfer is rejected (exit 413: soul-bound)
3. a stranger cannot destroy it (401); the issuer cannot revoke when minted with no authority (401)
4. the holder burns it: owner becomes null (this is how the Legend stage is detected)
5. the issuer can change the collection's base URL (editable collection); a stranger cannot (401)

Stage/picture changes need no on-chain action: the wallet fetches `<base-URL><index>.json`, which we serve and update.
Not covered here (needs a real wallet): how Tonkeeper and others cache and refresh the image.

## Testnet rehearsal (2026-10-12)
Collection `kQDq9U9wD-M6g7wWvBxwrQjk6Hb2Zx6QaghauSq6AnOAljt5`, passport #0 `kQCTI6Lda8xy0N1TTEH2rRyh443ruM4cf3K3RYIE08uybjYG`
(https://testnet.tonviewer.com/kQCTI6Lda8xy0N1TTEH2rRyh443ruM4cf3K3RYIE08uybjYG). The indexer (tonapi testnet) reads index, collection and owner correctly.
Metadata is read from `https://ttbik.vercel.app/zenobia/passport/<index>.json`, served from `public/zenobia/passport/` once deployed.
