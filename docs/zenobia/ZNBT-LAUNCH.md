# ZNBt launch runbook (owner)

**What this is:** a new independent coin, Zenobia of Tadmor (ZNBt), on its own bonding curve (fork of the open-source TONresistor launchpad, MIT, unaudited). It is not the Blum coin; the Blum coin is untouched.

**In the contract (tested):** holding journey per wallet (`get_journey`: Child 0-6 d, Queen 7-20 d, Warrior 21+ d, Captive = sold everything, Legend = burned everything; under 1 token counts as empty; buying again frees a captive), 9B supply, creator fee 2% + protocol fee 1% on every trade (both to the owner wallet), graduation at 1,000 TON into DeDust, on-chain name/symbol/description/small real Zenobia coin image (`image_data`) plus the animated Zenobia coin at `/zenobia/znbt-coin.webp` as `image`; the trade page uses the animated banner and the stage videos.

**Pay and launch (owner wallet only):**
1. Open `/zenobia/launch.html`, connect the owner wallet.
2. Step 1 "Deploy master" (about 2 TON). Wait for "deployed".
3. Step 2 "Create ZNBt" (about 1 TON, plus an optional first buy). Wait for "launched" and send the coin address shown to Claude, which fills `public/zenobia/znbt/config.json` so `/zenobia/trade.html` goes live.

**Not verified here:** the DeDust migration (needs mainnet; costs 20 TON from the raise, only at 1,000 TON), and wallet display of the animated image on every app. Fees: the creator fee falls to the owner wallet via the fee splitter claim; the protocol 1% goes to the master treasury (owner wallet) via withdraw.

## Open platform (anyone can launch)
- Master address (deterministic from the contract code): in `public/zenobia/znbt/config.json`. Anyone can send `CreateLaunch` to it; `/zenobia/create.html` does it for a normal user (name, symbol, description, image link, supply, creator fee 0-2% incl. 1.5%, graduation threshold, optional first buy).
- Fees: the platform takes **1.5%** of every trade on every coin (to the master treasury = the owner wallet); the coin's creator sets their own 0-2%. ZNBt itself uses 1.5% + 1.5% = 3%.
- `/zenobia/coins.html` lists every launch read from the master's transactions on-chain (nothing to trust but the chain). `/zenobia/trade.html?c=<coin address>` trades any coin; ZNBt keeps its real videos, other coins show the five journey emblems (`emblem-N-*.svg`).
- **Hide a coin:** open `/zenobia/coins.html#admin`, connect the **owner wallet** (a ton_proof signature is checked on the server; only the owner address passes), write an optional reason, press Hide / Unhide. Hiding removes the coin from our lists only; it stays on-chain and its page shows a "hidden by the platform" notice.
- **Collect platform fees:** in the same admin view press "Collect platform fees" on a coin (moves its 1.5% into the master), then "Withdraw platform fees".
- Creators collect their own fees on the coin page: step 1 move fees, step 2 withdraw.
