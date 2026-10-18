# Open launch platform: where it stands and what to add (2026-10-18)

## What the audit found
- **Scaling problem (fixed here):** every visitor's browser scanned the chain itself through a keyless toncenter endpoint (about 1 request per second, with retries). With real traffic the list would be slow or empty. Now a server **index** (`znbt_index`, refreshed every 5 minutes by `.github/workflows/znbt-index.yml` -> `/api/cron/znbt-index`) serves every visitor; the browser reads the chain only if the index is missing or older than 15 minutes. Setting a free `TONCENTER_API_KEY` makes refreshes about 8 times faster and is the one thing worth doing before launch day.
- The coins list had no search, sorting, progress or price; the trade page had no creator facts, sharing or way to report a coin; the Arabic fee line said "3%" for every coin although creator fees are chosen (0 to 2%).

## Added now (no contract change, nothing on mainnet)
| Feature | Where |
|---|---|
| Server coin index with live numbers (raised, graduation %, price) | `znbtIndex.ts`, `/api/zenobia/coins/index`, bundle `src/lib/vendor/znbtIndexer.cjs` (built by `web/build.mjs`) |
| Coins list: search, sort (newest / closest to graduation / most raised), filters (curve / graduated / watchlist), progress bars, NEW and Graduated badges, ★ watchlist (browser only), Telegram share | `coins.ts` |
| Trade page: coin facts (creator, date, supply, fees, contract, "no audit"), copy/Telegram share, **report a coin** | `trade.ts`, `/api/zenobia/coins/report` |
| Reports: 6 reasons, 5 an hour per address, one per coin per address, never hides anything by itself; the owner sees counts and the latest reason on the coins page (#admin) | `znbt_reports` |
| Create page: live preview, uppercase symbols, **reserved symbols blocked** (TON, USDT, ZNB, ZNBT ...), warning when a symbol already exists, terms link | `create.ts` |
| Terms and risks page (English and Arabic) | `public/zenobia/terms.html` |

## What similar platforms do (what the search could confirm)
- **Pump.fun (Solana):** bonding curve, graduation to its own AMM, a published fee split between creator, protocol and liquidity; in 2026 creators can split fees across up to 10 wallets, transfer ownership and change fee percentages after launch; livestream tokens were paused for abuse and returned with stricter moderation ([Decrypt](https://decrypt.co/352919/creator-capital-markets-pump-fun-streaming-twitch), [Whale Alert](https://whale-alert.io/stories/8f78ae601ed8/Pumpfun-Rolls-Out-Major-Creator-Fee-Changes-Teases-Big-PUMP-Future-Ahead)).
- **Bags, Raydium LaunchLab, Jupiter Studio, Four.meme, Clanker, Zora, SunPump:** fee sharing with many recipients (Bags up to 100), social verification (Bags), fee-rights NFT after graduation (LaunchLab), anti-sniper tools, optional LP locking and token vesting (Jupiter Studio), liquidity burned at graduation (SunPump) ([Coin Bureau](https://coinbureau.com/analysis/best-memecoin-launchpads)).
- **TON:** Blum Memepad (1B supply, 800M on the curve, liquidity locked at a 1,500 TON threshold, per Blum's own post, [Blum](https://blum.io/post/5-best-memecoin-trading-platforms-in-2025)); GasPump (wrapped tokens on the curve, unwrap 1:1, DeDust at a 1,000 TON hardcap, STON.fi option, [STON.fi blog](https://blog.ston.fi/ston-fi-integrates-with-gas-pump/)); ton.fun (bonding curve with no presales or insider allocations). The search did not return their fee rates or moderation details, so nothing about those is claimed here.
- Buyer-protection ideas from a proposal (MemeToro, not yet deployed): refunds, exit windows, wallet limits ([Coin-Turk](https://en.coin-turk.com/memetoro-vs-pump-fun-vs-four-meme-which-launchpad-protects-buyers-best/)).

## Next, safe without touching the contracts (suggested order)
1. **`TONCENTER_API_KEY`** (free) in Vercel env.
2. **Activity feed and price chart** from the trade events of each coin (index them the same way; a small candle chart on the trade page). Highest visual value.
3. **Trending** (volume in the last 24 h) and a **featured** row the owner picks (a flag next to the hidden list).
4. **Creator pages** (all coins of one wallet) and **holder distribution** (top holders as percentages, to show concentration).
5. **Verified badge** chosen by the owner after checking the creator's official channels (impersonation defence).
6. **Open Graph preview images** for coin links shared in Telegram and X.
7. Comments only with moderation tooling; otherwise skip (it is where scams and abuse concentrate).

## Needs a contract change (not done, deliberately)
Anti-sniper limits, vesting of the creator's first buy, LP lock proof, fee split across several wallets, post-launch fee changes. Any of these means new contract code, which changes the master address and needs a fresh deploy and, ideally, an audit. Recommended only after the platform has real use, and after an external review.

## Before inviting the public
- Have a lawyer read `terms.html` and the launch rules for the countries you target (it is plain-language, not legal advice).
- Keep the unaudited notice on every page (it is there).
- Decide who answers reports (the owner today) and how fast.
