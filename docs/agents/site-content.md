# Supervisor: Site content & tools (news, articles, free tools, SEO, errors)

Section id: `site-content` · rolling issue `Supervisor report: site-content` (label `supervisor-site-content`) · cadence: every 6 h.

## Mission
The public website `ttbik.vercel.app` (Arabic desk) and `/en` (English desk): news and articles stay fresh and correct, every free tool works, markets/prices data is live, SEO stays healthy, and site errors get fixed. Add valuable content/tools that bring visitors, within the rules.

## Territory
`src/app/{articles,news,events,en,prices,markets,free-tools,word-of-day,prayer-times,guess-word,tools,embed,faq…}/**`, `src/components/**` (site chrome, tickers, ad slots — keep ad labels), `src/lib/{freeTools,enFreeTools,toolSeo,enToolSeo,embedTools,newsItems,newsLive,newsRss,autoFeeds,articlesIndex,markets,ecbRates,lastGood,storeProfit,siteUrl}.ts`, `src/app/sitemap.ts`, `src/app/llms.txt`, `public/tools/**`, tests of those libs. Existing routine "Auto-fix site errors" handles `auto-error` issues hourly: do not duplicate; you look for quality problems *before* they become error issues.

## Never
Copying publishers' text/images/videos (headlines + link out; official embeds only — `docs/agent-outbox.md` rules), profit/return claims, new tracking/ad networks, removing ad labels, changing `layout.tsx` Athar/Zenobia chrome without need, Next/webpack pins, secrets.

## Health checks
1. Render key pages with the Playwright harness at phone width (home, `/news`, `/articles`, `/prices`, `/markets`, `/en`, each tool page): no console errors, no empty tickers ("—" everywhere), no horizontal scroll, ad slots labelled.
2. Tool QA: for each tool in `freeTools.ts` open the page, run one sample input (the calculators are pure client code; extract the math to `src/lib` + unit-test when you find logic only in components).
3. Data feeds: `/api/markets` and `/api/markets-en` return numbers (a failing provider is covered by `lastGood`, but note repeated failures); ECB table on `/prices` has today's date ±3 days.
4. News: latest items are recent (`newsLive`/`autoFeeds` sources reachable); articles index builds; sitemap lists every tool page; `llms.txt` current.
5. `npx tsc`, jest for these libs, and `git grep -n "TODO\\|FIXME"` in your territory.

## What you may do on your own
Fix bugs and layout/a11y/SEO defects (titles, descriptions, canonical, hreflang, JSON-LD) with tests; add tools to `freeTools.ts` (+ page, SEO block in `toolSeo.ts`, sitemap) — client-side only, no accounts, no uploads, honest "approximate, not professional advice" notes; refresh/curate news and articles from allowed sources; add FAQ/Schema; improve performance; keep the English desk at parity where it makes sense.

## Escalate
New ad networks or placements policy, anything paid, legal pages wording, domain/hosting changes (e.g. buying a custom domain), data-retention changes.

## Report fields
Pages rendered · tools checked · feeds status · defects fixed (PRs) · content added · needs-owner.

## Daily content: no deletions
Before any content push read `docs/notes/CONTENT_AGENT_NO_DELETE.md` (append only, run `node scripts/content-shrink-check.mjs <tip>`, build first). Incident: 8d111d08/aa54a02e on 2026-10-21 emptied 4 content files and failed two production deploys.
