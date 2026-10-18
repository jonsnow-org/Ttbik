# ZNBt launch runbook (owner)

**What this is:** a new independent coin, Zenobia of Tadmor (ZNBt), on its own bonding curve (fork of the open-source TONresistor launchpad, MIT, unaudited). It is not the Blum coin; the Blum coin is untouched.

**In the contract (tested):** holding journey per wallet (`get_journey`: Child 0-6 d, Queen 7-20 d, Warrior 21+ d, Captive = sold everything, Legend = burned everything; under 1 token counts as empty; buying again frees a captive), 9B supply, platform fee 1.5% + creator fee 1.5% on every trade (both to the owner wallet for ZNBt, 3% in total), graduation at 1,000 TON into DeDust, on-chain name/symbol/description/small still of the new Zenobia coin (`image_data`, on-chain) plus the animated coin at `/zenobia/znbt-coin.webp` as `image`; the trade page uses the chapter-2 banner and stage videos in `/zenobia/znbt/art/` (made from the owner-generated stills by `docs/zenobia/animation/cfgs_znbt.py`).

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
- `public/zenobia/znbt/config.json` has `"open": false` until the owner decides: while false, `create.html` shows "Not open yet" and its button is disabled. Set `curve` (ZNBt address) and `"open": true` together at launch.

## ZNBt and the Blum coin ZNB are two different coins
- ZNB (Blum): 1,000,000,000 fixed supply, set by Blum; no creator fee; its image and data cannot change. ZNBt: 9,000,000,000 supply on its own curve (about 90% sold on the curve, about 10% goes to DeDust at graduation), 3% fees to the owner wallet.
- Nothing links them on-chain: no conversion, no airdrop, no shared journey. Holding one gives nothing on the other. Do not call ZNBt a "new edition" or an "upgrade" of ZNB: say it is a separate coin, chapter 2 of the story.
- The passport, hall, board and bot still read the **ZNB** jetton only (`src/lib/zenobiaPay.ts` `holdsCoin`). Decide before launch whether they should also accept ZNBt.

## Launch day (2026-10-18 evening): everything below is prepared; nothing has been sent to mainnet
**Before:** the owner wallet `UQBt3hz…QJSz` must hold **at least 4 TON** (it held 0.81 TON when checked on 2026-10-18): master about 2 TON, coin about 1 TON, plus your optional first buy and fees. The launch page shows the balance and warns when it is low.

**The owner's steps (about 5 minutes):**
1. Open `https://ttbik-gate.jonsnowx1r.workers.dev/zenobia/launch.html` (the permanent address; it follows whichever server is up), connect the owner wallet.
2. **Step 1 · Deploy master**, wait for "deployed ✅" (Refresh).
3. **Step 2 · Create ZNBt** (choose a first buy or 0), wait for "launched ✅".
4. Nothing else is needed for the pages: the platform finds ZNBt by itself within 5 minutes (address, launch time for the age badge). Check `…/zenobia/znbt/config.json` shows `curve`.
5. When you are ready for other people to launch coins: the **Zenobia bot** ← `/platform` ← **«🪙 فتح المنصة للجميع»** (and «⛔ إغلاق المنصة» to close again; it also shows ZNBt's status, the coin count and the reports). It refuses to open before ZNBt exists.

**Claude then (no deploy needed):** runs the chain check (`node znbt-verify.cjs <coin>`; build with `cd contracts/zenobia-curve/web && npx esbuild src/verify.ts --bundle --platform=node --outfile=/tmp/znbt-verify.cjs`), checks `/jetton2` in the Zenobia bot, the age badge icon (`/api/zenobia/znbt/icon`) and the coin pages.

**Permanent facts fixed at launch (they cannot be changed afterwards):** name and symbol, 9B supply, fees 1.5% + 1.5%, graduation at 1,000 TON, the coin's `image` = `https://ttbik-gate.jonsnowx1r.workers.dev/api/zenobia/znbt/icon` (the gate's permanent address, served by Oracle or Vercel), a small static picture stored on-chain as fallback.

**Rollback:** nothing to undo before step 1. After step 1 the master stays deployed (it costs nothing to keep); the platform stays closed (`open` false) until you open it from the panel.

### Announcement drafts (English first, no promises of profit)
> **Zenobia of Tadmor (ZNBt) is live on TON.** 🪙 A coin that remembers your journey: hold it and grow from Child to Queen to Warrior; sell everything and you become a Captive; burn it and you become a Legend. Fees: 1.5% platform + 1.5% creator. Experimental, unaudited contracts: you can lose everything you put in. Not financial advice. Terms and risks: https://ttbik-gate.jonsnowx1r.workers.dev/zenobia/terms.html
>
> **زنوبيا التدمرية (ZNBt) على شبكة TON.** 🪙 عملة تتذكّر رحلتك: احتفظ بها لتنمو من طفل إلى ملكة إلى محارب؛ بع كل شيء فتصير أسيراً؛ احرقها فتصير أسطورة. الرسوم 1.5% للمنصة + 1.5% للمُطلِق. العقود تجريبية وغير مدقَّقة وقد تخسر كل ما تضعه. ليست نصيحة مالية. الشروط والمخاطر: الرابط أعلاه.

### The age badge
The coin's `image` points to `/api/zenobia/znbt/icon`, which serves a pre-rendered animated badge for the coin's age (`new`, `1d`..`29d`, `1m`..`11m`, `1y`..`10y`; 51 files in `public/zenobia/znbt/age/`, built by `docs/zenobia/animation/make_age_icons.py`). Limits, stated plainly: the metadata is immutable, so this endpoint must stay up for as long as the coin exists (the gate is the permanent address); wallets and explorers cache the picture, so some will show an older age for a while. The age counts from the coin's launch time on the chain.

### Telegram Stars never appear on the ZNBt platform
Stars exist only in the Athar bot, behind `ATHAR_ENABLE_STARS=1` (off by default), and in the owner's admin queue. No `/zenobia/*` page, script or API mentions them. See `docs/ATHAR_STARS.md`.
