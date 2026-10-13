# ZNBt launch runbook (owner)

**What this is:** a new independent coin, Zenobia of Tadmor (ZNBt), on its own bonding curve (fork of the open-source TONresistor launchpad, MIT, unaudited). It is not the Blum coin; the Blum coin is untouched.

**In the contract (tested):** holding journey per wallet (`get_journey`: Child 0-6 d, Queen 7-20 d, Warrior 21+ d, Captive = sold everything, Legend = burned everything; under 1 token counts as empty; buying again frees a captive), 9B supply, creator fee 2% + protocol fee 1% on every trade (both to the owner wallet), graduation at 1,000 TON into DeDust, on-chain name/symbol/description/small real Zenobia coin image (`image_data`) plus the animated Zenobia coin at `/zenobia/znbt-coin.webp` as `image`; the trade page uses the animated banner and the stage videos.

**Pay and launch (owner wallet only):**
1. Open `/zenobia/launch.html`, connect the owner wallet.
2. Step 1 "Deploy master" (about 2 TON). Wait for "deployed".
3. Step 2 "Create ZNBt" (about 1 TON, plus an optional first buy). Wait for "launched" and send the coin address shown to Claude, which fills `public/zenobia/znbt/config.json` so `/zenobia/trade.html` goes live.

**Not verified here:** the DeDust migration (needs mainnet; costs 20 TON from the raise, only at 1,000 TON), and wallet display of the animated image on every app. Fees: the creator fee falls to the owner wallet via the fee splitter claim; the protocol 1% goes to the master treasury (owner wallet) via withdraw.
