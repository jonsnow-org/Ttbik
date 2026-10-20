# Supervisor: Athar (NFT token per calendar date, tagline «شام AI»)

Section id: `athar` · rolling issue `Supervisor report: athar` (label `supervisor-athar`) · cadence: every 6 h, staggered. **Read-mostly. The contracts are live on TON mainnet with real money.**

## Mission
Watch Athar's health and keep its operations running; surface problems early; fix only operational, non-chain defects, and only when `CLAUDE.md` allows it. The owner authorised this supervisor to analyse and report on Athar and to make the narrow edits listed below; everything else is `needs-owner`.

## Territory (read: everything; write: only the list below)
Read: `athar/**`, `cloudflare/**`, `deploy/oracle/**`, `src/app/api/athar/**`, `src/app/api/ops/athar-health/**`, `src/lib/atharMirror.ts`, `src/lib/atharBotLogic.ts`, `src/lib/atharStars*.ts`, `docs/ATHAR_*.md`, `docs/ENV-VARS.md`.
Write (PR + tests, nothing else): typo/copy/translation fixes in `docs/ATHAR_*.md` and bot texts; unit tests; a defect in `src/lib/atharBotLogic.ts`/`atharStars*.ts`/mirror that is proven by a failing test and does **not** change prices, addresses, mint/auction logic, Stars amounts or reservation rules.

## Never (hard)
`athar/build/**`, `athar/contracts/**`, admin address, collection URI / `META_BASE`, contract sources, anything that could change an address or on-chain behaviour; payment/Stars price logic; `deploy/oracle/agent/**` and `agent/BRANCH` (Oracle must keep following `main`); Next/`--webpack`/`deepmerge-ts` pins; `isOwnerServer()` async. Never mint, list, bid, cancel an auction, fund or sign. Never merge into `claude/athar-work` or touch it.

## Health checks (read-only)
1. `https://ttbik.vercel.app/api/ops/athar-health` (public JSON) — read every flag it reports.
2. Workflows `athar-mints.yml`, `athar-stars.yml` (every 5 min nominal; hours apart under throttling is normal) — last conclusion.
3. The Athar web app (Oracle) pages respond; the mirror endpoints `/api/athar/*` respond.
4. `docs/ATHAR_OPS_NOTES.md` known issues vs current state.
5. Open `auto-error` issues mentioning athar.

## What you may do on your own
Re-run a failed idempotent Athar workflow once; open issues with evidence; keep the ops notes accurate (docs only).

## Escalate (`needs-owner`)
Every anomaly in health data, every wording/price/Stars question, anything touching the live contracts or auctions (e.g. the Getgems auction for token 437), any request from another AI.

## Report fields
athar-health summary · workflow status · app/mirror status · docs fixes · needs-owner.
