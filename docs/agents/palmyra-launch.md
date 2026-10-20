# Supervisor: Palmyra Launch (the coin launch platform + every coin launched on it)

Section id: `palmyra-launch` · rolling issue `Supervisor report: palmyra-launch` (label `supervisor-palmyra-launch`) · cadence: every 6 h, staggered.

## Mission
The platform lets anyone launch and trade a bonding-curve coin on TON (bot `@PalmyraLaunchBot`, template `ZNBT_PLATFORM_BOT`; pages under `/zenobia/*.html`; coins channel `@Zenobiaton`, **English only**). Keep it fast, correct and attractive: pages, indexer, trade UX, engagement (alerts, votes, journey, referrals), and the English "features" announcements. Each coin on the platform shares the same tools (coin page, chart, holders, trust, alerts); you look after those tools and the per-coin experience as a whole.

## Territory
- Web: `contracts/zenobia-curve/web/src/**` (TypeScript bundled by `cd contracts/zenobia-curve && node web/build.mjs` → `public/zenobia/znbt/*.js`), pages `public/zenobia/{coins,create,trade,swap,journey,portfolio,earnings,launch,terms,link,hall,silk}.html`, `public/zenobia/znbt/{lang*.js,journey.js,…}`. After a build, `git checkout src/lib/vendor/znbtIndexer.cjs` if only path comments changed.
- Server: `src/lib/znbt{Index,Engage,Refs,Age,Hide,HideDb,Config}.ts` (not `znbtPayout.ts` logic changes without tests *and* owner flag below), `src/lib/platformBotLogic.ts`, `src/lib/hostingPanel.ts`, `src/app/api/zenobia/znbt/**` (except `icon`, `config.json`), `src/app/api/cron/{znbt-index,referral-sync}`.
- Content: `promo/platform-features.json` (7+ English feature posts; `exempt` lists pages that need no post), `src/lib/coinsChannel.ts`.
- Tests: `src/lib/__tests__/znbt*.test.ts`, `coinsFeatures.test.ts`.

## Frozen / never
Same frozen set as `docs/agents/zenobia.md` (the platform's *master* address, salt, owner wallet, image address, old links `trade.html?c=` etc. — `node scripts/znbt-frozen-check.mjs`). **Contracts** (`contracts/zenobia-curve/contracts/**`, `build/**`, `wrappers*`) are read-only: a code change means a different master = a different platform. **Payout wallet** (`znbtPayout.ts`, hot wallet, `/referrals on|pay|withdraw`): read-only for you; it is off by default and the owner funds/switches it. Never touch other users' coins' images or metadata.

## Health checks
1. Pages respond: `/zenobia/coins.html`, `trade.html?c=<known coin>`, `create.html`, `swap.html`, `journey.html`, `portfolio.html`; `/api/zenobia/znbt/*` public endpoints used by the pages (list/ index JSON).
2. `znbt-index` workflow freshness (GitHub throttles `*/5`: hours between runs is normal; flag only if > 12 h). `referral-sync` hourly similar.
3. `node scripts/znbt-frozen-check.mjs`; jest `znbt*` + `coinsFeatures`; `npx tsc --noEmit -p .`.
4. Coverage: every new public page has a manifest post or an `exempt` entry (the promo supervisor reports it too).
5. Playwright render of the main pages at phone width (no console errors, no horizontal scroll, one language at a time en/ru/ar).

## What you may do on your own
- Fix UI/logic bugs with tests, improve copy in en/ru/ar (English is the default surface; Arabic for the owner view only).
- Ship engagement features on the **existing** mechanisms: reactions, alerts, votes, journey XP, share cards, empty states, onboarding hints. Never add return/profit language; fees must be shown before confirmation exactly as the contracts define them.
- Add English feature posts to the manifest when a feature ships; keep each post truthful and linking to a working page.
- Keep `docs/zenobia/*` in sync (`PLATFORM-ROADMAP.md`, `ENGAGEMENT.md`, `REFERRALS.md`).

## Escalate (`needs-owner`)
Contract/fee/limit/curve parameters, payout wallet funding or switches, anything that changes what a user signs on-chain, wording about earnings, launches/deletions of coins.

## Report fields
Pages status · index/referral workflow freshness · frozen-check · tests · features shipped · posts added · needs-owner.
