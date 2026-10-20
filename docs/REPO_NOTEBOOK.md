# Repository notebook — how everything works (Ttbik / «شام AI»)

Last updated 2026-10-20. Written for whoever comes next: a Claude session, a scheduled supervisor, Grok. Read `CLAUDE.md` first (the owner's notice: hands-off list and standing orders), then `docs/agents/COMMON.md` if you are an autonomous agent, then this notebook. The owner reads Arabic; code, commits and PRs are English.

## ملخّص للمالك (عربي)
هذا الملف خريطة المستودع كاملة: ما هي الأقسام (الموقع، البوتات والتطبيقات المصغرة، العملات زنوبيا وPalmyra Launch وأثر، الترويج، شام/نوڤا، أداة الصورة المتكلمة)، كيف يُنشر كل شيء (Oracle وVercel والبوابة)، ما الذي يعمل آلياً (مهام GitHub والمشرفون)، كيف نختبر، وما الأخطاء التي وقعنا فيها كي لا تتكرر. المشرفون الآليون (بوت لكل قسم) وقواعدهم في `docs/agents/`. الحارس الذي يمنع أي وكيل من لمس صور العملات والعقود وسير العمل: `deploy/hosting/protected-paths.json` + `scripts/agent-guard.mjs` + `.github/workflows/agent-guard.yml` (يحتاج وسم `owner-approved` ليمرّ تغيير مراجَع).

---

## 1. What this is
One owner, a **zero-dollar budget** (no paid service, ever — never suggest one), several products on one codebase:
1. **Website** `ttbik.vercel.app` (Arabic desk) + `/en` (English desk): news, articles, 30+ free browser tools, markets/prices, ads (Adsterra), tool embeds.
2. **Hosted Telegram bots + Mini Apps**: a bot factory (one webhook, many templates), the dating/marriage bot and app, jobs, confession, quiz, prayer, media bot, the ad bot `@Admen10bot`, creator hub bots.
3. **Coins on TON**: *Zenobia* (ZNB / the independent coin **ZNBt**, passports, caravan bot), **Palmyra Launch** (the bonding-curve launch platform where ZNBt lives; bot `@PalmyraLaunchBot`, coins channel `@Zenobiaton`, English only), and **Athar** (a real NFT token per calendar date, tagline «شام AI», live on mainnet with real money).
4. **Promotion machine**: channel posts, promo videos (Telegram, GitHub Releases, YouTube v3), announcements, the daily promo supervisor.
5. **Sham AI model** (NOT ours): the owner's own model project, owned by **another session** (`ai-system/`, `sham-*` workflows, Kaggle/ModelScope/Lightning/Modal/HF). Its training files are hands-off for the main session and every supervisor, even inside our sections (another session may use a path there as a workaround). Kaggle is reserved for that model only. Nova (the old assistant) is **paused** (`src/lib/novaPause.ts`).
6. **Supervisor bots** (new, 2026-10-20): one scheduled agent per section, charters in `docs/agents/`.

Product rules (what we sell and don't): `docs/AGENT_BUS.md` and `README.md`. Never promise profit; never sell code files; no paid tools.

## 2. Directory map
| Path | What |
|---|---|
| `src/app/**` | Next.js 16 App Router: pages, API routes (`src/app/api/**`), cron endpoints (`api/cron/*`, secret-gated), ops endpoints (`api/ops/*`) |
| `src/lib/**` | all server/shared logic. `*BotLogic.ts` per bot template; `match/**` dating bot; `znbt*`/`zenobia*` coins; `channel*`/`coinsChannel`/`announce` promo; `markets`/`autoFeeds`/`ecbRates` data feeds; `freeTools`/`toolSeo` tool registry |
| `src/components/**` | site chrome (tickers, `AdSlot`/`AdsterraSlot`, banners), tool UI |
| `src/lib/__tests__/**` | the jest suite (≈ all server logic) |
| `public/**` | static: `zenobia/` (coin/platform pages + **images**), `tools/` (model files), `promo/`, `og/`, `img/` |
| `contracts/zenobia-curve` | Palmyra Launch contracts (Tolk), SDK, tests and **`web/`** (TypeScript for the platform pages, bundled into `public/zenobia/znbt/*.js`). `zenobia-coin`, `zenobia-passport`, `zenobia-silk`: coin/passport/silk contracts |
| `athar/` | Athar: contracts, web app (`athar/web`, runs on Oracle), tests, scripts, docs. **Hands-off** |
| `cloudflare/` | the front-door Worker `site-gate` (+ `athar-meta`). **Hands-off** |
| `deploy/oracle/**` | Oracle server: Docker compose, Caddy, updater/backup/watchdog agent (`agent/BRANCH` = `main`), zenobia-ledger. **Hands-off** |
| `deploy/hosting/` | `site.json` (public identity), `znbt-frozen.json`, `protected-paths.json`, `CRONS_ON`, env checks |
| `prisma/` | `schema.prisma` + `migration_*.sql` (the owner runs SQL manually in Supabase) |
| `supabase/` | older SQL, grants |
| `ai-system/` | **Not ours.** Sham/Nova Python (FastAPI brain, Kaggle/ModelScope/Lightning/Modal/HF deploys, training), owned by the Sham-model session. Hands-off |
| `media-bot/` | the Python media bot (Docker on Oracle) |
| `promo/` | promo hub: `README.md`, `platform-features.json`, `remotion/` (video pipeline + `episodes.json`), `projects.json` |
| `scripts/` | `znbt-frozen-check.mjs`, `agent-guard.mjs`, `agent/render-check.mjs`, `promo/*`, `hosting/*`, `qa/*`, `vercel-ignore.sh`, **`sham-assist/`** (numpy helpers offered to the Sham-model session: audio augmentation, viseme intelligibility gate, face curation; accepted terms on PR #2; nothing under a Sham path) |
| `docs/**` | notes. Live sources of truth: `AGENT_BUS.md`, `HOSTING.md`, `zenobia/*`, `ATHAR_OPS_NOTES.md`, `ENV-VARS.md` (names only), this file, `agents/*` |
| `.github/workflows/**` | ~55 workflows (see §6) |
| `e2e/` | Playwright spec for the dating Mini App |
| `templates/`, `render.yaml` | legacy/bot templates, Render config for Nova |

## 3. Architecture and hosting
```
Telegram / browsers / Mini Apps / GitHub schedules
              │
   https://ttbik-gate.jonsnowx1r.workers.dev   (Cloudflare Worker "gate": one permanent address; also serves the coin icon from its own cache)
              │ auto: Oracle first, Vercel if Oracle fails
     ┌────────┴─────────┐
 Oracle (primary)     Vercel (backup)  ttbik.vercel.app
 Caddy → site container
     └────────┬─────────┘
   one Postgres (Supabase) — DATABASE_URL shared
```
- **Branches and deploys (corrected 2026-10-10):** `main` → Oracle (Athar web app + site engine) and is only a Vercel *preview*. The **default branch** `claude/free-services-marketplace-h6rwk2` → Vercel production (site, bots, `/api/athar/*` mirror). A change reaches users **only after `main` is merged into the default branch** (a "sync PR", merge commit). `claude/athar-work` belongs to the Athar session: never push/merge/delete it.
- **Vercel free plan is rate-limited** (a 24 h lock when too many deployments). `vercel.json` → `scripts/vercel-ignore.sh` skips builds for Athar-only, docs, SQL, cloudflare, deploy/oracle, ai-system and `sham-*` workflow changes; preview deployments are not built. Batch work; one sync per day (`docs/agents/COMMON.md` §2). Standing order: in a fixes session collect fixes and merge once when the owner says the session is over.
- Hosting notes and the Cloudflare gate: `docs/HOSTING.md`. Env var **names**: `docs/ENV-VARS.md` (values never in the repo; a `deploy/hosting/check-env.sh` audits).
- **Webhooks** all point at the gate. Telegram webhook per bot: `/api/telegram/[botId]` (secret header = `Bot.webhookSecret`).
- **Database**: Prisma over Supabase Postgres. Many feature tables are created on first use with `CREATE TABLE IF NOT EXISTS` (e.g. `znbt_ref_*`, `hosting_flags`, `youtube_publish_state`); model tables come from `prisma/migration_*.sql` which the **owner runs manually**. Any change to tables/columns/indexes/grants must be flagged **by filename** to the owner (`docs/AGENT_BUS.md`), and new tables need `GRANT … TO service_role`.

## 4. Sections in detail

### 4.1 Website
- Root layout `src/app/layout.tsx` is async/dynamic (reads `x-pathname`, owner cookie). It server-renders both **market tickers** with data (`fetchMarkets` / `fetchEnMarkets`, 2.5 s cap, last-good fallback in `src/lib/lastGood.ts`) — never regress to client-only (crawlers saw dashes).
- Tools: registry `src/lib/freeTools.ts` (Arabic) / `enFreeTools.ts` (English); each tool = `src/app/free-tools/<slug>/page.tsx` + client component, SEO block in `toolSeo.ts` (`ToolSeoSection`), sitemap entry in `src/app/sitemap.ts`, optional embed in `embedTools.ts`. Registering in `freeTools.ts` also puts the tool in the **public channel rotation** (`channelPool.ts`) and in the supervisor's coverage check. Pure math belongs in `src/lib` with unit tests (`storeProfit.ts`, `lastGood.ts` are examples).
- Ads: Adsterra units via `AdSlot` → `AdsterraSlot` (header banner, in-content under the result, footer; sticky dismissible mobile ad `StickyBottomAd`). Every slot shows "Advertisement · إعلان". No ads on owner/money/admin pages (`monetagGate.ts`, `siteAds.ts`).
- `/prices`: ECB daily table + USD-pegged Gulf/Jordan currencies computed from ECB EUR/USD and the official pegs (`ecbRates.ts`; floating currencies like EGP are deliberately absent).
- News/articles: `newsItems`, `newsLive`, `newsRss`, `autoFeeds`, `articlesIndex`. Rules: headlines + link out, official embeds only; no copying publishers' text/images/videos. `llms.txt`, `indexNow` for crawlers.

### 4.2 Hosted bots and Mini Apps
- One dispatcher `src/app/api/telegram/[botId]/route.ts` handles: pre-checkout for **Stars** (approved immediately for every bot except Athar which validates), private-chat filter, then per-template logic (`*BotLogic.ts`). Templates: AD_BOT (public), owner-only password-gated ones (MARRIAGE, JOBS, MEDICAL, NOVA, CONFESSION, NAME_COMPAT, QUIZ, STREAK, PRAYER, CAPSULE, HUB_*), plus ATHAR_BOT, ZENOBIA_BOT, ZNBT_PLATFORM_BOT, CHANNEL_PUBLISH_BOT, SITE_BANNER_ADMIN, FADAA_BOT.
- **Payments**: Telegram Stars (`src/lib/starsPayment.ts`; payload `"<KIND>:<userId>"`, credited idempotently on the Stars charge id via `creditStarsPayment`), NOWPayments crypto (`/pay/*`, webhooks under `api/payments/*`), TON memo deposits (`src/services/*TonService.ts`). Per-bot ledgers (MatchTransaction, JobsTransaction, …) never mix.
  **Lesson 2026-10-20:** in the marriage/jobs/confession bots the owner (super admin) went down a text-only admin path that returned before the `successful_payment` handler, so *his* Stars payments were never credited (bot or Mini App invoice alike). Fixed by crediting payments first, before every gate (`handle*StarsPayment`); regression test `starsPaymentGate.test.ts`. Mini App invoices (`/api/match-app/[botId]` → `starsInvoiceLink`) respect Telegram's 32/255 limits, log the real error, and the client falls back to `openTelegramLink`.
- Dating bot: `matchBotLogic.ts`, `src/lib/match/**` (entitlements, anon chat, social, premium, hybrid inline mode), Mini App `src/app/match-app/[botId]/MatchMiniApp.tsx` (framer-motion, Telegram WebApp API: BackButton with exit confirm — standing order, MainButton, haptics), API `src/app/api/match-app/[botId]/route.ts` (every call verifies `initData` with that bot's token). QA doc `docs/MATCH_APP_QA.md`, e2e `e2e/match-app.spec.ts`, mocks `scripts/qa/*`.
- Standing UI orders: the Back button must ask before leaving (never silently collapse); one-line explanation per owner-bot button; Arabic user surfaces, but coins surfaces are English first (ru/ar via language button).
- Owner bots' health: `/api/ops/bots-health` (secret-gated), the public `/bots/health-check` tool.

### 4.3 Coins
**Zenobia** (`docs/zenobia/*`, `src/lib/zenobia*.ts`): caravan bot `@Zenobia_Palmyrabot`, journey stages (child → queen → warrior, captive), seasons, passports (SBT collection on mainnet; silk passports owner-gated), ledger wallet container on Oracle. ZNB (Blum coin) vs ZNBt (independent, 9 B supply) — see `docs/zenobia/OPERATIONS.md`.

**Palmyra Launch** (platform): contracts `contracts/zenobia-curve` (master `EQAagBm1…DCh-`, owner wallet `UQBt3hzF…Sz`, salt `1000001`), web bundle from `contracts/zenobia-curve/web` (`cd contracts/zenobia-curve && node web/build.mjs` → `public/zenobia/znbt/*.js`; running it can dirty `src/lib/vendor/znbtIndexer.cjs` path comments: `git checkout` it), pages `public/zenobia/{coins,create,trade,swap,journey,portfolio,earnings,launch,terms,link}.html`, indexer `znbtIndex.ts` + cron `znbt-index`, engagement `znbtEngage.ts` (reactions, alerts, votes, journey), referrals `znbtRefs.ts` and the **payout hot wallet** `znbtPayout.ts` (**default OFF**; owner funds it and sends `/referrals on`; caps: min 0.25 GRAM, 20 GRAM/inviter/day, 50 GRAM/day, 0.1 GRAM reserve, 3 payouts per run). Platform bot: `platformBotLogic.ts` (users English; owner sees Arabic + button legend; `/referrals`, `/platform`). Coins channel `@Zenobiaton` posts: `coinsChannel.ts` + `promo/platform-features.json` (English only, no return promises, only once ZNBt exists).

**Frozen forever** (the chain remembers): the coin's image address `…/api/zenobia/znbt/icon` (served by the gate from its own copy), master/owner/salt, old links `trade.html?c=…`. Safeguards: `deploy/hosting/znbt-frozen.json` + `node scripts/znbt-frozen-check.mjs` (CI), hourly `znbt-guard` → `/api/cron/znbt-guard`. Coin/stage/passport **images and art are identity**: never replace, re-encode, rename or delete (`protected-paths.json`).

**Athar** (`athar/`, `docs/ATHAR_*`, `docs/ATHAR_OPS_NOTES.md`): one token per date, mint/auction/Stars purchase, bot, mirror on Vercel (`/api/athar/*`, `atharMirror.ts`), `/api/ops/athar-health`. Live money: hands-off; the Athar session works on `claude/athar-work`.

### 4.4 Promotion
Read `promo/README.md`. Summary: public channel `@ttbik5` (2-hourly, rotation built **automatically** from `freeTools`/landings/news + the hand-kept one-time list `channelChangelog.ts`), coins channel (3×/day from `coinsChannel.ts`), promo videos (`promo-remotion.yml` renders Remotion episodes `promo/remotion/episodes.json` to GitHub Releases `promo-ep-N`, posts to Telegram via `/api/cron/promo-publish`, and uploads to **YouTube Data API v3** through the same endpoint with `to=youtube`). Publishing is off until `promo/PUBLISH_ON` exists or `publish=1`. YouTube: `src/lib/youtubePublish.ts` + `/api/youtube/oauth` (one-time owner consent with a Desktop-type OAuth client: the redirect ends on `http://localhost`, the owner pastes that address into the form `?form=1`, the code is exchanged on POST only — GET links get prefetched by browsers and burn the single-use code); needs `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET` in Vercel; refresh token stored in `youtube_publish_state` (never displayed). Daily health report: `scripts/promo/supervise.mjs` via `promo-supervisor.yml` into the open issue "Promo supervisor: daily report" (label `promo-supervisor`); it also checks coverage (every tool in the rotation, every public coins page in the manifest or `exempt`).

### 4.5 Sham AI model / Nova (`ai-system/`) — NOT OURS
Owned by another session (owner's order 2026-10-20: the site, tools, bots, coins and hosting are the main Claude session's; *training the Sham model* is not). Description for orientation only — do not edit, re-run or tidy any of it, even files that look stray inside our sections.
Own-model project. Kaggle GPU notebooks train **Sham only**; ModelScope Studio (CPU) serves it; Lightning Studio collects data; workflows `sham-*`. Nova (assistant bot) paused by owner directive 2026-09-24. Do not use these resources for anything else, and do not build features that need a GPU elsewhere. Machine-checked: `protected-paths.json` rule `sham-model` (site-side glue `src/lib/sham{Memory,Studio}.ts` is a warn-level rule: leave it unless a site error forces a minimal fix).

### 4.6 Talking photo tool (`/free-tools/talking-photo`, `src/app/free-tools/talking-photo/*`)
Runs entirely in the browser. `engine.ts`: Delaunay triangle-mesh warp of MediaPipe face landmarks (468 pts + z) or a synthetic ring around a tapped mouth; painted throat/tongue/teeth; blink; **head motion = aperiodic seeded noise** (`drift`, tuned to SadTalker audio2pose statistics: 1–3° yaw, 3–6° pitch, 1.5–3° roll, 5–20°/s; guarded by `talkingPhotoHead.test.ts`); tilt pivot at 0.62H, roll soft-capped, zoom 1.12 so no corner shows; canvas MediaRecorder → MP4/WebM with the "AI-generated" mark; consent checkbox; delete-video button. `voice.ts`: f0 estimate, cepstral envelope formant shift, WSOLA pitch shift, effects (female, girl, deep, robot, alien, monster, radio). `viseme.ts`: reduced re-implementation of HeadAudio (MIT; MFCC 16 kHz/40 mel/12 coeffs + Mahalanobis classifier with the 39-prototype model `public/tools/talking-photo/viseme-model.bin`, licence copied). Loudness maps to jaw opening (`levelFromDb`, tests in `talkingPhotoLevel.test.ts`).
**Study results (2026-10-19/20), do not redo blindly:** SadTalker (real neural renderer) on a 4-core CPU: 5.6 s/frame (SPADE decoder 4.1 s, dense motion 1.4 s, encoder 0.2 s), ≈ 922 GFLOP/frame, 9.5 min for a 4 s clip; int8/fp16 does not cut FLOPs; pruning decoder blocks without retraining collapses quality (PSNR 16–23 dB); its audio2exp is loudness-insensitive (shout ≈ normal) so it cannot fix mouth amplitude; its audio2pose (11 M params) is small and was used as the head-motion reference. Browser-side neural rendering on phones is unmeasured; GPU services are off the table (no paid tools, Kaggle reserved). A realistic future path is a slow queued CPU job on GitHub Actions (~4.5 min per 4 s at 12 fps + interpolation) as a *second* option beside the instant tool. Owner wants "real motion, not animation": the current tool is warp animation.

## 5. Quality of life facts learned the hard way
- **Sandbox network**: HTTPS goes through a local proxy that re-signs TLS (`/root/.ccr/README.md`); never disable TLS verification. Chromium needs `--proxy-server=$HTTPS_PROXY` and the proxy CA: `scripts/agent/render-check.mjs` trusts exactly that CA by SPKI hash. Some hosts are blocked by policy (report, don't route around). Browser CDN fetches may fail → cache assets and route them in Playwright.
- `pkill -f` patterns can kill your own shell; start servers with the tool's background mode, stop them by PID.
- `next dev` **appends a block to `AGENTS.md`** — `git checkout -- AGENTS.md` before committing (it is on the protected list).
- GitHub **schedules are throttled**: a `*/5` workflow may run every few hours; judge freshness in hours, not minutes. Don't "fix" it.
- Vercel connector shows no teams (needs re-linking by the owner); read production state via public pages, `gh api repos/jonsnow-org/Ttbik/commits/<sha>/status` (Vercel context) and `get_pull_request`/Actions tools.
- GitHub access is through the GitHub MCP tools (or `gh api` for reads); the Actions *secrets* API is blocked — you cannot see secret names.
- Merge flow used everywhere: branch from `origin/main` → push → PR → squash-merge → one sync PR `main → claude/free-services-marketplace-h6rwk2` (merge commit). If a feature branch was already squash-merged, start a fresh branch from `origin/main`.
- Auto-mode permission classifiers may block hot-wallet/real-money commands regardless of what you write; stop and report, don't work around.
- Arabic RTL text breaks URLs when copied from chat: give URLs alone in a code block with an ASCII placeholder.
- A secret pasted into chat is compromised: tell the owner to rotate it; never reuse it in code or commands.

## 6. Automation inventory
Scheduled GitHub workflows (cron nominal; real cadence slower): `channel-post` (2-hourly), `coins-channel-post` (3×/day), `promo-remotion` (Sun/Tue/Thu), `promo-projects` (Mon), `promo-supervisor` (09:05/21:05 Istanbul), `error-triage` (hourly → `auto-error` issues), `znbt-guard` (hourly), `znbt-index`, `referral-sync` (hourly; also runs payouts only if enabled), `zenobia-season`, `zenobia-watch`, `athar-mints`, `athar-stars`, `site-crons` (daily jobs formerly Vercel Cron), and the `sham-*` family (Sham AI only). New: `agent-guard` (PR check, protected paths).
Scheduled **routines** (Claude sessions): "Auto-fix site errors" (hourly, fires into the main session) and the six **section supervisors** (`docs/agents/README.md`).
Cron endpoints under `src/app/api/cron/*` are secret-gated (`CRON_SECRET` as header or `?secret=`): agents do **not** call them directly (no secret access); workflows do.

## 7. Testing and verification
- Type check: `npx tsc --noEmit -p .` (must be clean).
- Jest (official): `cd athar && npx jest --config ../jest.media.config.js --rootDir .. <name-pattern>` (all `src/lib/__tests__/*.test.ts`).
- Node tests: `node --test scripts/promo/supervise.test.mjs scripts/agent-guard.test.mjs`.
- Frozen coin facts: `node scripts/znbt-frozen-check.mjs [--chain]`.
- Protected paths: `node scripts/agent-guard.mjs --base origin/main`.
- Render check (phone width, console errors, overflow, text markers): `node scripts/agent/render-check.mjs <url>… [--expect text] [--forbid text] [--screenshot dir]`.
- Local app: `npx next dev --webpack -p <port>` (then revert `AGENTS.md`). The site works without a DB for most pages.
- Contracts/web bundle: `cd contracts/zenobia-curve && node web/build.mjs`.
- Build: `npm run build` = `prisma generate && next build --webpack` (CI does it on every push).
- Prove a regression test: stash your fix and see it fail (the payment test failed 3 of 4 on the old code).

## 8. Standing owner orders (decision log)
- No paid tools; honest reporting; no profit promises; do things himself-free ("without manual work").
- Coins channel and platform user surfaces English; Arabic for the owner; one language at a time.
- Back button: exit confirmation. One-line explanation per owner-bot button.
- Payout wallet: built, default OFF; owner authorised it in his own messages; he funds it and sends `/referrals on`. Invite reward share is modest and auto-paid when on.
- Fix rounds: merge once at the end (rate limit), but ship money/safety fixes promptly.
- Athar/cloudflare/deploy-oracle/framework pins: hands-off unless he asks in the session.
- Kaggle: Sham training only.
- **Ownership split (2026-10-20):** everything about the site, tools, bots/Mini Apps, coins (incl. Athar), promotion and hosting — on Vercel, Oracle or anywhere — is the main Claude session's, with full authority to organise it; everything about training the Sham AI model is another session's and untouchable (see `CLAUDE.md`).
- Talking photo: quality first, commercial-licence risk accepted, >100 MB download acceptable; stop blind tweaking — measure first.
- Promo: every new tool/feature must reach the channels automatically; verify with the supervisor.

## 9. Open items for the owner (2026-10-20)
Finish YouTube consent (add `YOUTUBE_CLIENT_ID/SECRET` in Vercel, run `/api/youtube/oauth` once, finish with `?form=1`) and rotate the secrets that were pasted in chat (`CRON_SECRET`, Google client secret, Vercel token); fund the payout wallet and send `/referrals on` when ready; verify first real invite credits against the chain before paying; cancel the Getgems auction for Athar token 437; re-link the Vercel connector; review Russian/Arabic wording on the platform; decide on custom domain, token encryption at rest, PDF/other tool ideas from the external audits.

## 10. How to add things
- **A free tool**: lib math + test → page + client component → `freeTools.ts` entry → `toolSeo.ts` block → `sitemap.ts` → (optional) `enFreeTools.ts`/embed. It auto-enters the channel rotation.
- **A platform feature post**: add an entry to `promo/platform-features.json` (English, link to a working page, `repeatDays`); `coinsFeatures.test.ts` validates language/links/no-promises.
- **A one-time announcement** for the public channel: `src/lib/channelChangelog.ts`.
- **A promo video episode**: `promo/remotion/episodes.json` (copy an existing episode; `channel: "coins"` ⇒ English, `needs: "znbt"` ⇒ only after the coin exists).
- **A bot template**: add logic file + branch in the dispatcher + deploy route list + tables (SQL flagged by filename) + tests; Stars payments must credit before any gate.
- **A supervisor**: `docs/agents/<section>.md` + routine (see `docs/agents/README.md`).
