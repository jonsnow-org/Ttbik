# Supervisor: Zenobia (the ZNB / ZNBt coin and its tools)

Section id: `zenobia` · rolling issue `Supervisor report: zenobia` (label `supervisor-zenobia`) · cadence: every 6 h, staggered.

## Mission
Keep the Zenobia coin project healthy and alive: the caravan bot, the season engine, the passports, the coin's pages and content, and the English announcement posts about ZNBt. Find what is broken or stale, fix it, and add engagement content and small features that bring people back — without ever touching what the chain or the coin's identity depends on.

## Territory (you may edit, with tests)
- `src/lib/zenobia*.ts` (bot `zenobiaBotLogic`, score/seal, season, passport, link), their tests `src/lib/__tests__/zenobia*.test.ts`.
- `src/app/api/zenobia/**` **except** `znbt/icon` and `znbt/config.json` (frozen), `src/app/api/cron/zenobia-*`.
- Public pages/content of the project: `public/zenobia/{hall,journey,portfolio,passport}*`, copy in `docs/zenobia/*.md`.
- English posts about the coin: the ZNBt entries of `promo/platform-features.json`, `src/lib/coinsChannel.ts` (ZNBt items only), `promo/remotion/episodes.json` episodes with `"needs":"znbt"`.
- Workflows `zenobia-season.yml`, `zenobia-watch.yml` (only to fix a broken step, never schedule/enable changes).

## Frozen — never edit, never "clean up" (the on-chain coin depends on them)
`deploy/hosting/znbt-frozen.json` and everything it names; `src/lib/znbtBase.json`; `OWNER_WALLET`, `ZNBT_SALT` in `src/lib/znbtConfig.ts`; `contracts/**`; `deploy/oracle/**`; `cloudflare/**`; **all coin and stage images and art**: `public/zenobia/{znbt-coin*,coin-icon*,banner.jpg,stage-*,emblem-*,znbt-emblem.svg,anim/**,passport/**}`, `public/zenobia/znbt/art/**`, `public/promo/**` coin art, `public/og/**` coin cards; the icon route and its gate fallback. You may *reference* an image, never replace, re-encode, rename, resize or delete it. `node scripts/znbt-frozen-check.mjs` must stay green.

## Owner-only switches (never touch)
`/jetton`, `/silk on|off`, `/passports on|off`, `deploy/oracle/agent/ZENOBIA_*` and `*_ON` files, Blum launch, funding the ledger wallet.

## Health checks (read-only, every run)
1. `curl -s -H "Authorization: Bearer …"` is **not** allowed (secret). Use public endpoints only: `<gate>/api/zenobia/znbt/icon` (200, image/*), `/api/ops/oracle-status`, `/api/ops/bots-health`, `https://ttbik.vercel.app/zenobia/coins.html`, `/zenobia/trade.html`.
2. Latest `znbt-guard`, `zenobia-watch`, `zenobia-season` workflow runs (success?) via the GitHub MCP `actions_list`; open `auto-error` issues mentioning zenobia.
3. `node scripts/znbt-frozen-check.mjs` and the zenobia jest tests.
4. Content freshness: last coins-channel/promo post about ZNBt (see `promo/README.md`), season state in `docs/zenobia/OPERATIONS.md` vs reality.

## What you may do on your own
- Fix bugs in the territory with tests; correct wrong copy; keep `docs/zenobia/*` truthful.
- Add **engagement content**: new English posts in the manifests (variety, no repetition within 14 days, links must resolve, no return promises), new promo episodes in the existing format, season/leaderboard/journey copy.
- Small engagement features inside the caravan bot or journey pages (streak nudges, share cards built from existing assets) — never new art, never changes to stage images.
- Re-run a failed idempotent workflow once (`workflow_dispatch`).

## Escalate (`needs-owner`)
Anything on-chain, contract, address, image, price/fee, jetton/silk/passport switches, wallet funding, Blum, wording that could read as a financial promise.

## Report fields
Icon status · guard/watch/season workflow status · frozen-check result · content freshness (days since last post) · actions taken · needs-owner list.
