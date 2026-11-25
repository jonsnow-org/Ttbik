# Supervisor coverage — one scheduled monitor

The repository keeps one charter per project section, but it does not run a separate scheduled bot for every charter. These documents define scope, safety boundaries and escalation; one read-only monitor performs the operational checks.

| Section id | Charter | Looks after | Scheduled coverage |
|---|---|---|---|
| `zenobia` | [zenobia.md](zenobia.md) | ZNB / ZNBt coin, caravan bot, seasons, passports, the coin's English posts | hourly via monitor.yml |
| `palmyra-launch` | [palmyra-launch.md](palmyra-launch.md) | the launch platform + the per-coin tools every coin shares (pages, indexer, alerts/votes/journey, referrals read-only, coins channel features) | hourly via monitor.yml |
| `athar` | [athar.md](athar.md) | Athar NFT project — **read-mostly**, reports only operational facts | hourly via monitor.yml |
| `telegram-bots` | [telegram-bots.md](telegram-bots.md) | every hosted bot template, Mini Apps, bot payments | hourly via monitor.yml |
| `promo` | [promo.md](promo.md) | channels, videos, YouTube, announcements, coverage of new tools/features | hourly via monitor.yml |
| `site-content` | [site-content.md](site-content.md) | news, articles, free tools, markets/prices, SEO, site errors | hourly via monitor.yml |

Shared rules: [COMMON.md](COMMON.md) (read first; it is protected — a PR that changes it needs the owner's `owner-approved` label). Map of the whole repository: [../REPO_NOTEBOOK.md](../REPO_NOTEBOOK.md). Guide for Grok: [../GROK_GUIDE.md](../GROK_GUIDE.md).

## How monitoring runs
The `.github/workflows/monitor.yml` workflow is the only scheduled supervisor. It runs hourly at minute 11 UTC and invokes `scripts/supervisors/run.mjs all` for all six sections: zenobia, palmyra-launch, telegram-bots, site-content, promo and athar. It rewrites one issue, `Monitoring: all systems`, rather than maintaining separate scheduled reports for each section.

The former `promo-supervisor.yml`, `error-triage.yml`, `oracle-freshness.yml`, `stale-issues.yml` and per-section supervisor workflows were retired on 2026-11-14; they are not active schedules. Promo and site-content are sections of the unified report, not separate scheduled jobs.

The monitor has `actions: read` permission and issue-write permission only to maintain its report and repeated-error issues. It is read-only with respect to deployments, bots and publishing: it never dispatches or reruns workflows, publishes to Telegram, merges pull requests, or changes funds. It edits the single issue silently; a comment (= an e-mail) is added only after a failure lasts 6+ hours and once more on recovery. Repeated site errors create an `auto-error` issue only when the same fingerprint reaches 10 occurrences. Fixes are made through reviewed code changes, not by rerunning publishing workflows.
## Technical safety net (not just rules)
- `deploy/hosting/protected-paths.json` lists what no agent may change. **Owner's order 2026-11-22: it covers ONLY Athar, the coin platform (Palmyra Launch), the coins and the contracts; the rest of the repository (servers, gate, workflows, database files, bots, site, tools) is no longer guarded.** Owner's order 2026-11-06 removed every hands-off rule except Athar, so the list now holds only live-money guards (the coin and stage images, frozen coin facts, contracts, Athar, Oracle, the gate, the payout wallet); the Sham AI model and the general notices were removed. `scripts/agent-guard.mjs` checks a change against it; `.github/workflows/agent-guard.yml` runs it on every pull request (skipped for the `main → production` sync PR and the Athar session's branch). The owner lets a reviewed exception through by labelling the PR `owner-approved`.
- `scripts/znbt-frozen-check.mjs` (CI on every push) fails the build if the coin's on-chain facts drift.
- Hourly `znbt-guard` watches the coin's image address, the gate and both servers.
- Merge flow limits Vercel builds: one sync PR per day per supervisor, only for production-relevant changes.

## Adding or changing a monitored section
1. Write/adjust `docs/agents/<section>.md` (mission, territory, frozen, owner-only switches, health checks, allowed actions, escalation, report fields).
2. Add the section to `SECTIONS` in `scripts/supervisors/run.mjs` (pages, workflows with a max age in hours, error-issue keywords) (`monitor.yml` runs every section in one job: `run.mjs all`); extend `scripts/supervisors/run.test.mjs`.
3. Add the section to the table above.

Working on both branches (production + `main`) without collisions: see `docs/BRANCH_FLOW.md`.
