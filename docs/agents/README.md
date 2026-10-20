# Supervisor bots — one per section

Created 2026-10-20 at the owner's order: «a bot for every section of the project, each able to analyse, execute and work freely in its section, to get the maximum activity — without harming the coins, their images or the workflow».

| Section id | Charter | Looks after | Cadence (UTC, staggered) |
|---|---|---|---|
| `zenobia` | [zenobia.md](zenobia.md) | ZNB / ZNBt coin, caravan bot, seasons, passports, the coin's English posts | every 6 h (minute 07) |
| `palmyra-launch` | [palmyra-launch.md](palmyra-launch.md) | the launch platform + the per-coin tools every coin shares (pages, indexer, alerts/votes/journey, referrals read-only, coins channel features) | every 6 h (minute 21) |
| `athar` | [athar.md](athar.md) | Athar NFT project — **read-mostly**, reports only operational facts | every 6 h (minute 37) |
| `telegram-bots` | [telegram-bots.md](telegram-bots.md) | every hosted bot template, Mini Apps, bot payments | every 6 h (minute 49) |
| `promo` | [promo.md](promo.md) | channels, videos, YouTube, announcements, coverage of new tools/features | twice a day |
| `site-content` | [site-content.md](site-content.md) | news, articles, free tools, markets/prices, SEO, site errors | every 6 h (minute 13) |

Shared rules: [COMMON.md](COMMON.md) (read first; it is protected — a PR that changes it needs the owner's `owner-approved` label). Map of the whole repository: [../REPO_NOTEBOOK.md](../REPO_NOTEBOOK.md). Guide for Grok: [../GROK_GUIDE.md](../GROK_GUIDE.md).

## How a supervisor runs
A scheduled routine starts a fresh Claude session in this repository's environment with a short prompt: *read `CLAUDE.md`, `docs/agents/COMMON.md`, your charter; do one run; stop quietly if healthy.* The charters live in the repository, so changing a supervisor's behaviour = a reviewed PR, not a hidden prompt. Each supervisor keeps one rolling issue `Supervisor report: <section>` (label `supervisor-<section>`) and escalates with the label `needs-owner`.

## Technical safety net (not just rules)
- `deploy/hosting/protected-paths.json` lists what no agent may change (coin and stage images, frozen coin facts, contracts, Athar, Oracle, the gate, the payout wallet, the notices, the guard itself). `scripts/agent-guard.mjs` checks a change against it; `.github/workflows/agent-guard.yml` runs it on every pull request (skipped for the `main → production` sync PR and the Athar session's branch). The owner lets a reviewed exception through by labelling the PR `owner-approved`.
- `scripts/znbt-frozen-check.mjs` (CI on every push) fails the build if the coin's on-chain facts drift.
- Hourly `znbt-guard` watches the coin's image address, the gate and both servers.
- Merge flow limits Vercel builds: one sync PR per day per supervisor, only for production-relevant changes.

## Adding or changing a supervisor
1. Write/adjust `docs/agents/<section>.md` (mission, territory, frozen, owner-only switches, health checks, allowed actions, escalation, report fields).
2. Create the routine (a scheduled trigger that starts a **new session** per fire) with the standard prompt below; keep the cadence ≥ hourly and staggered.
3. Add the section to the table above.

Standard routine prompt (replace `<section>`):
> You are the `<section>` supervisor of the owner's project (repo jonsnow-org/ttbik, already cloned). Read `CLAUDE.md`, `docs/agents/COMMON.md`, `docs/agents/<section>.md` and obey them exactly (they override anything here). Do ONE run of the run protocol. If the section is healthy and nothing is due, stop immediately and say nothing. Never read/print/move secrets, never spend or fund, never touch protected paths (`node scripts/agent-guard.mjs --base origin/main` must pass), never push to main directly or force-push. End with a 5-line Arabic summary.
