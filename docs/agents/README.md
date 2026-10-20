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
Supervisors are **GitHub Actions bots**: they run on GitHub's schedule whether or not any Claude session exists. `.github/workflows/section-supervisors.yml` (every 6 hours) runs `scripts/supervisors/run.mjs <section>` for zenobia, palmyra-launch, telegram-bots, site-content and athar; `promo-supervisor.yml` does the same for promo. Each keeps one rolling issue `Supervisor report: <section>` (label `supervisor-<section>`), rewritten every run, with a comment only when the status changes; a non-ok status adds the label `needs-attention`. The only automatic action is one rerun of failed jobs of idempotent workflows (`RERUN_OK`); they never edit code, merge, post, or touch money. A Claude session (or the owner) reads the issues and does the fixing; the charters in this folder say what it may do. (Scheduled Claude routines were tried and removed: they cannot reach GitHub and depend on a session being alive.)

## Technical safety net (not just rules)
- `deploy/hosting/protected-paths.json` lists what no agent may change (coin and stage images, frozen coin facts, contracts, Athar, Oracle, the gate, the payout wallet, the notices, the guard itself). `scripts/agent-guard.mjs` checks a change against it; `.github/workflows/agent-guard.yml` runs it on every pull request (skipped for the `main → production` sync PR and the Athar session's branch). The owner lets a reviewed exception through by labelling the PR `owner-approved`.
- `scripts/znbt-frozen-check.mjs` (CI on every push) fails the build if the coin's on-chain facts drift.
- Hourly `znbt-guard` watches the coin's image address, the gate and both servers.
- Merge flow limits Vercel builds: one sync PR per day per supervisor, only for production-relevant changes.

## Adding or changing a supervisor
1. Write/adjust `docs/agents/<section>.md` (mission, territory, frozen, owner-only switches, health checks, allowed actions, escalation, report fields).
2. Add the section to `SECTIONS` in `scripts/supervisors/run.mjs` (pages, workflows with a max age in hours, error-issue keywords) and to the matrix in `.github/workflows/section-supervisors.yml`; extend `scripts/supervisors/run.test.mjs`.
3. Add the section to the table above.
