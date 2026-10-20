# Guide for Grok (and any other outside supervisor)

You are welcome to supervise this project. This page tells you how to do it **without harming the coins, their images, the money flow or the workflow**. Read in this order: `CLAUDE.md` (the owner's notice) → `docs/agents/COMMON.md` → `docs/REPO_NOTEBOOK.md` → the charter of the section you pick (`docs/agents/*.md`). The message bus with Claude is `docs/AGENT_BUS.md` (PR #2 comments tagged `🤖 GROK:`).

## What you can do safely (and are encouraged to)
- Pick **one** section and work like its supervisor: observe, find defects, fix them with tests, add content/features the charter allows, report in the section's rolling issue.
- Review other agents' PRs and say what looks risky (comment only).
- Improve docs, tests, tool QA, SEO, copy, promo content, engagement features inside charters.

## The five things that can hurt (the guard exists for these)
1. **The coin's identity**: the image address `…/api/zenobia/znbt/icon` is written on-chain and must answer 200 forever; the coin, stage, emblem, passport and banner images and art must never be replaced, re-encoded, renamed or deleted; master address / owner wallet / salt must never change. Checks: `node scripts/znbt-frozen-check.mjs`, hourly `znbt-guard`.
2. **Contracts and Athar**: `contracts/**`, `athar/**`, `athar/build/**` — live or future on-chain code with real money. Read-only for you.
3. **Money switches and secrets**: payout hot wallet (`src/lib/znbtPayout.ts`, `/referrals on`), silk/passport sales, `*_ON` flag files, any key/token/word list. Never read, print, move or use them.
4. **Servers and the gate**: `deploy/oracle/**`, `cloudflare/**`, `deploy/hosting/site.json`, Oracle must follow `main`.
5. **Workflow cadence**: Vercel's free plan locks for 24 h if flooded with builds. One PR per coherent change, one sync PR (`main` → `claude/free-services-marketplace-h6rwk2`) per day, never per fix. Don't edit `.github/workflows/**`, `vercel.json`, `package.json` pins without a clear need and a review.

Run `node scripts/agent-guard.mjs --base origin/main` before every push. CI repeats it on each PR; a blocked path means "ask the owner" (he labels the PR `owner-approved` if he agrees). You cannot weaken the guard: its files are on the protected list.

## Mechanics you need
- Branch from `origin/main`; open a PR to `main`; squash-merge when checks are green; never push to `main` or `claude/athar-work`; never force-push.
- Production = the default branch `claude/free-services-marketplace-h6rwk2`: changes reach users only after the sync PR.
- Verify before claiming: `npx tsc --noEmit -p .`, jest (`cd athar && npx jest --config ../jest.media.config.js --rootDir .. <pattern>`), `scripts/agent/render-check.mjs` for pages. Details: `docs/REPO_NOTEBOOK.md` §7.
- Language: coins channel and coins platform users are **English only**; public texts English first; reports to the owner in short Arabic. Never promise profit.
- When a decision, payment, secret, mainnet action or launch is needed: stop, comment on an issue, label `needs-owner`.

## Your roll call
Post one comment in PR #2: `🟣 ROLL CALL: GROK-<section> — <trigger/cadence> — <territory>` and tag later messages with it (see `docs/AGENT_BUS.md`).
