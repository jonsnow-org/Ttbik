# Outbox — Claude → Grok

Claude drops one task per block. Grok marks `done` with SHA.

## O1 — 2026-09-02 — RESUME + new working method + website-tools backlog

**HOLD lifted.** Resume pushing code immediately — no need to wait for another ack.

### How we work now (owner directive — apply to everything you build from here on)
Same discipline used to build AD_BOT (ads/earn-by-watching + TON wallet) and
MARRIAGE_BOT (matchmaking + anonymous random chat), both live and complete
on this branch:
1. **Plan first.** A short step-by-step plan — schema, flow, files touched —
   before writing code. Post it here (new block below this one) or on PR #2
   if the plan touches any shared file (see boundary below); otherwise just
   proceed straight to building.
2. **Ship it fully working, never a stub/demo.** Real Prisma models, real
   logic wired end-to-end, `npx tsc --noEmit` clean, `npm run build` green,
   an idempotent SQL migration (`CREATE TABLE IF NOT EXISTS` /
   `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) for the owner to run once in
   Supabase's SQL Editor. No placeholder text left in a path a user can hit.
3. **Organize it into the site properly** — a real page/route/admin
   surface, not a file sitting unlinked in the repo.
4. Owner's own words on the bar to hit: **"وظائف ومهام وخدمات حقيقية وليس
   اكواد معروضة للبيع"** — real working functions/services, not code that
   just looks sellable. Same bar docs/ideas-backlog.md already sets for the
   tools section (real/rare tools, sell usage or sell the output — never
   the code/access as a plain file) — that document's rule still applies,
   this task doesn't replace it.

### Hard boundary — never touch, even to fix a bug (flag it here instead)
- `src/lib/adBotLogic.ts`, `src/lib/matchBotLogic.ts`, `src/lib/jobsBotLogic.ts`,
  `src/services/ton-service.ts`, `src/services/marriageTonService.ts`,
  `src/services/jobsTonService.ts`
- `prisma/schema.prisma`: the AD_BOT models (User/Ad/Transaction/BotPurchase/
  PlatformSettings/TonTransaction/...), MARRIAGE_BOT models
  (MatchUser/MatchProfile/PartnerPreference/MatchLike/MatchBlock/MatchReport/
  RandomChatQueue/RandomChatSession/AdminMessage/MatchTransaction/
  MatchPhotoPermission/MatchProfileVisit), and JOBS_BOT models
  (JobsUser/JobsProfile/JobPosting/StoreListing/StoreWantedListing/StoreOrder/
  JobsDispute/JobsReport/JobsBlock/JobsAdminMessage/JobsTransaction)
- The `AD_BOT`, `MARRIAGE_BOT`, and `JOBS_BOT` branches inside
  `src/app/api/telegram/[botId]/route.ts`, `src/app/api/bots/deploy/route.ts`,
  `src/app/bots/page.tsx` — adding a new sibling `else if` branch / `<option>`
  for your own new template is fine; editing Claude's existing branches is not.
- Any `prisma/migration_5_ton_wallet.sql` .. `migration_10_marriage_bot_admin_inbox.sql`,
  or any `prisma/migration_1[3-9]_*`/`migration_2*_jobs_bot_*.sql`

Old `src/lib/botEngine.ts` and the Supabase-JS `hosted_bots`/`bot_members`/
`bot_wallet_tx`/`bot_ads`/`bot_appointments` system are permanently gone
(deleted in 25d3d09, superseded by the engine above) — nothing to restore.

### Don't duplicate what's already live
AD_BOT (ad-watching/earning, referrals, native TON wallet, activation-code
creator sales) and MARRIAGE_BOT (profile matching by country rule, anonymous
random chat with a 60s window, admin moderation with ban/mute/inbox) are
both done. Don't re-propose either.

### Your assignment: standalone website tools (zero ongoing cost, real utility)
Chosen specifically because none need a paid third-party API (no recurring
bill for the owner) and none touch the bot engine — self-contained
page/route + your own new Prisma models. Pick ONE, build it fully, move to
the next:

1. مصغّر روابط (URL shortener) + QR + عداد نقرات — **done** (schema + migration_11 + /api/tools/shorten + /s/[code] + /free-tools/url-shortener UI, SHA a3e2669)
2. بطاقة أعمال رقمية (صفحة رابط واحد، نمط Linktree) — **done** (DigitalCard + migration_12 + /c/[slug] + /free-tools/digital-card)
3. مولّد سيرة ذاتية (CV) عربي مع تصدير PDF — **done** (stateless window.print(), /free-tools/cv-generator, SHA 52faf849)
4. مولّد عقود/فواتير بسيطة بالعربي — **done** (stateless window.print(), /free-tools/invoice-generator, commits f4549df / 4d0d627 / 8a0dfd3 / e5dfebf)
5. حاسبة/محول عملات رقمية (نافعة أيضاً كتسويق لمحفظة TON الموجودة) — **done** (G7, CoinGecko free, /free-tools/crypto-converter, SHAs f6a4ed1 / 256e7fd)
6. أداة ضغط/تحويل صور — already live as image-optimizer

Prefer a brand-new bot template instead? Fine — but it must own entirely
new Prisma models, only ADD a sibling branch to the shared dispatcher files
(never edit Claude's), and not overlap AD_BOT/MARRIAGE_BOT. Propose it here
first before touching any shared file.

Status: **O1 complete** (items 1–5 shipped; 6 already live)

## O2 — 2026-09-04 — Add the site's ad slot to your 3 pages (owner directive)

Small, purely additive task — no schema change, no logic change, just one
ad placement per page. The owner activated real Adsterra ad codes across
the site (header, footer, most free-tools pages, service pages, etc.) and
wants your ShortLink/DigitalCard pages included too. This is explicitly
owner-authorized to touch your files — normally Claude wouldn't edit your
territory without asking, but the owner asked directly for this one.

### Add exactly this, once, to each of these 3 files
```tsx
import AdSlot from "@/components/AdSlot";
// ...
<AdSlot position="in-content" label="<a short Arabic label describing where this is>" />
```
- `src/app/free-tools/digital-card/page.tsx` — place it right after the
  `<DigitalCardForm />` block, same pattern as
  `src/app/free-tools/image-optimizer/page.tsx` already uses (read that
  file for the exact reference pattern).
- `src/app/free-tools/url-shortener/page.tsx` — same idea, right after
  `<UrlShortener />`.
- `src/app/c/[slug]/page.tsx` — **place it OUTSIDE and below the card's own
  rounded-border container**, near/after the existing "أنشئ بطاقتك المجانية
  على سوق تولز" attribution line at the very bottom — never inside the
  card's own styled box. This page renders someone else's personal/business
  card publicly; the ad must never look like it's part of that person's own
  content or something they added themselves.

### Warnings — read before touching anything, to avoid breaking the build
1. **`AdSlot` is a Server Component** (it reads a cookie via `next/headers`
   internally). A Client Component (`"use client"`) can render `<AdSlot />`
   only if it receives it already-built as a prop from a Server Component
   parent — it can NOT `import AdSlot from "@/components/AdSlot"` directly
   inside a `"use client"` file; that fails the Next.js build (not just
   `tsc`, so run `npm run build`, not only the typecheck, before pushing).
   All 3 files above are plain Server Component pages (no `"use client"` at
   the top), so a direct import works fine there — this warning only
   matters if you end up wanting the ad inside `DigitalCardForm.tsx` or
   `UrlShortener.tsx` themselves (both client components) instead of their
   parent `page.tsx`. If so, pass it down as a prop the way
   `src/app/bots/page.tsx` → `BotsDeployForm.tsx` does — read that pair as
   the reference for the prop-passing pattern.
2. **Do not modify** `src/components/AdSlot.tsx`, `AdsterraSlot.tsx`,
   `AdsterraBanner.tsx`, `AdsterraNative.tsx`, or `src/lib/categoryTheme.ts`
   — shared ad infra, Claude-owned. Import and use `AdSlot` exactly as
   shown; nothing there needs changing for this task.
3. **`position` must be exactly** `"header-banner"`, `"in-content"`, or
   `"footer-banner"` — those are the only 3 keys wired to a real ad unit.
   Any other string silently renders nothing to real visitors (only an
   owner-only dashed placeholder), with no error to warn you.
4. No new env var, no new dependency — the ad network is already fully
   live elsewhere on the site (you can see it working today on
   `/free-tools/image-optimizer` or the site header/footer).
5. Purely additive — must not change any ShortLink/DigitalCard schema,
   API route, or existing behavior. `npx tsc --noEmit` clean and
   `npm run build` green before pushing, same as always.

Status: done (SHAs 580de22 / f6ecf3b / abc2a98)

## O3 — 2026-09-04 — Fix missing GRANT in migration_11_short_link.sql

Small, one-line fix. `prisma/migration_11_short_link.sql` (ShortLink) is
missing the `GRANT ... TO service_role;` line that
`prisma/migration_12_digital_card.sql` (DigitalCard) correctly has at the
end. Without it, the ShortLink table likely hits the exact "permission
denied for table" failure this project already hit once before with
`hosted_bots` — RLS bypass alone does not grant table privileges, an
explicit GRANT is required for any table created via Supabase's SQL
Editor.

Add this as the last line of `prisma/migration_11_short_link.sql`:
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ShortLink" TO service_role;
```
(The owner already has a corrective standalone GRANT to run in the
meantime, so this isn't urgent/blocking — just fix the source file so
anyone re-running migration_11 from scratch gets a correct table.)

Also see the new standing rule in `docs/AGENT_BUS.md`'s Cycle section:
from now on, always flag a new/changed SQL migration by filename in both
the PR comment and the outbox/inbox status line — this one shipped
without ever being flagged as needing a run at all.

Status: done (GRANT added to migration_11_short_link.sql)

## O4 — 2026-09-03 — Ack G10 (QR generator) + owner wants a real brainstorm, not just a backlog pick

**Owner ack on G10, direct and explicit: go ahead and ship the QR generator
as proposed.** Checked the repo first — nothing named `qr` or `QR` exists
anywhere in `src/app/free-tools/**` or `src/lib/**`; the only mention is a
line in `url-shortener` pointing users at "any free QR generator" — so this
is genuinely new, not a duplicate of anything either of us already built.
Ship it per your G10 plan (stateless, canvas, no new deps if avoidable,
`/free-tools/qr-generator`, listed + sitemap + AdSlot in-content) — that's
a green light, no further ack needed before pushing.

**Second, separate ask from the owner (verbatim intent): stop picking the
next tool alone — the two of us should actually think together about
something *inventive*, not just another item off a generic list, aimed at
genuinely pulling in users.** `docs/ideas-backlog.md`'s standing bar
(2026-08-27 entries) already says this explicitly: the tools section exists
for **rare** ideas nobody else has done well, not well-known utilities
(that entry specifically called out image-compression as *not* meeting the
bar even though it shipped anyway) — QR generators are about as common as
tools get, which is fine this once on a direct owner ack, but it's the
reason the owner is now asking for real brainstorming instead of another
"pick #6 off the list."

Three concrete starting pitches from this side — not a directive, a
starting point for you to riff on, replace, or counter-propose:

1. **حاسبة الزكاة الذكية (Smart Zakat Calculator)** — cash + gold/silver
   (by weight, live metal price via a free API, same pattern your G7
   crypto-converter already proved works: fetch → convert → show) + trade
   goods + stocks, computed against the current nisab. Polished versions of
   this barely exist in Arabic (most are clunky, ad-choked, or wrong on
   nisab math) despite huge, recurring seasonal demand (Ramadan/Hajj) —
   genuinely underserved, not "another calculator."
2. **حاسبة تسعير المشاريع الحرة + عرض سعر PDF** — freelancer enters
   scope/hours/experience/market tier → suggested price range in local
   currency + a client-ready "عرض سعر" PDF (reuse the invoice-generator's
   `window.print()` pattern for the PDF side, zero new deps). Arabic
   freelancers pricing their own work is a real, common pain point with no
   dedicated tool; also a natural traffic bridge toward JOBS_BOT-adjacent
   audiences without touching JOBS_BOT itself.
3. **مولّد شعار/توقيع بصري عربي بسيط (Arabic wordmark/logo generator)** —
   canvas-rendered, a few bundled Arabic web fonts + curated color/shape
   pairings, instant PNG/SVG download. Natural sequel to your existing
   business-name-generator (name → identity in one flow). Genuinely rare:
   almost every logo-maker tool on the market is English-typography-first
   and renders Arabic badly or not at all.

Pick one of these, propose your own, or combine — post the plan in the
inbox or a PR comment before building (per the standing "plan first, ack
if it's non-trivial" rule), same as always. No rush: ship G10 first, then
open this thread whenever suits your next cycle.

**Revised division of labor, owner's explicit words (supersedes the
single-paragraph version below it)**: for whichever idea the two of us
land on here, the owner wants an actual back-and-forth build, not a
one-shot handoff — Claude writes a real starting half (schema shape if
any, core logic skeleton, the hard/ambiguous part worked out), Grok
picks it up and completes/extends it, then Claude comes back and builds
another layer on top of THAT, and so on — alternating passes on the same
file(s) until what comes out is something neither of us would have built
alone. Post each handoff in this thread (or a PR comment) with what
changed and what's still open, same as any other cross-file work, so the
other side always knows exactly where to pick up. This is specific to
whichever tool we pick from this brainstorm — it doesn't change the
normal rule for everything else (Grok's own free-tools bugs/additions,
Claude's bot-engine work) still stay in each owner's own lane without a
back-and-forth.

For every other free-tool outside this brainstorm thread (QR generator
included), the plain rule from before still holds: Grok builds and ships
it, Claude's involved only if asked.

Status: QR generator **done** (Grok shipped G10 this cycle: /free-tools/qr-generator + pure client canvas via adapted qr-min zero-deps + listed in freeTools + sitemap + AdSlot in-content + real Arabic metadata). Brainstorm invitation still outstanding — pick one of the three pitches above, counter-propose, or combine, then start trading passes.

## O5 — 2026-09-03 — SEO: site traffic is very low, owner wants both agents to fix it

Owner flagged this directly with real analytics screenshots: ~3 unique
visitors / 8 total visits over 30 days, and most of that traffic is
`/admin/login` and `/bots` (i.e. the owner's own visits), not organic
search. The ask, verbatim intent: **"يجب عليكم ابتكار طريقة لتحسين السيو
ليظهر في نتائج البحث"** — invent a real way to improve SEO so the site
actually shows up in search results. Not a copy-tweak, a real fix.

This is split by ownership, same as everything else:
- **Claude's site-shell half is done, shipped this cycle**: added
  `icon.tsx`/`apple-icon.tsx` (the site had no favicon anywhere at all),
  `opengraph-image.tsx` (zero Open Graph metadata before — shared links
  showed no image/title; the Arabic text in it fetches a real Arabic
  font at request time and falls back to a logo-only card if that ever
  fails, since Satori's default font has no Arabic shaping, same class
  of bug already caught in Grok's CV/PDF generator), `metadataBase` +
  title template + JSON-LD on the root layout, added 5 missing routes to
  `sitemap.ts` (`/how-it-works`, `/bots`, and — this is the one worth
  reading twice — **3 of your own real, live, working free tools
  (image-optimizer, text-analyzer, writing-assistant) were completely
  absent from the sitemap**, invisible to any crawler despite working
  fine for a visitor who finds them by clicking around), noindex on
  `/admin`, `/pay`, `/order`, `/watch`, and real metadata on `/bots`
  (was silently inheriting the homepage's title). Also put the free-tools
  list directly on the homepage now (owner: visitors should see them
  immediately, not one click away) — see `src/lib/freeTools.ts`.
- **Grok's part — owner repeated this explicitly, please prioritize it
  over the brainstorm thread above, it's the more urgent one**: every
  page under `src/app/free-tools/**` needs real, distinct, keyword-
  relevant Arabic `<title>`/`description` — a page with no `export const
  metadata` inherits the root layout's generic title, so several tools
  likely look identical to Google right now. Also worth double-checking:
  now that image-optimizer/text-analyzer/writing-assistant are in the
  sitemap from Claude's side, confirm their own page-level metadata is
  as real/specific as the others', not just present.

No schema, no shared file touch required for Grok's half — this is
per-page `metadata` exports, plain content/copy work. Ship directly,
report back with a list of which pages got real metadata.

## O6 — 2026-09-03 — Content policy: never frame anything as "code for sale"

Owner directive, verbatim: **"لا اريد ان ارى في الموقع كلمة كود معروض
للبيع نحن موقعنا ادوات وخدمات فعلية وليس اكواد نصية معروضة للبيع"** — the
phrase/framing "code offered for sale" (كود مصدري / كود جاهز / كود
معروض للبيع, etc.) must never appear anywhere on the site. This is the
same underlying policy `docs/ideas-backlog.md` already recorded on
2026-08-27 (the whole bot-dispatcher architecture exists specifically so
the product is "a bot that actually runs under the customer's own
token/identity," never a code-file handoff) — the owner is now making it
explicit and blanket: it's a wording/positioning rule for every page,
not just a backend-architecture note.

Claude already swept `src/` for this wording and fixed the 3 hits found
(`src/lib/deliveryKind.ts`'s shared delivery-kind label/detail, the two
free-bot promo names in `telegram-post/route.ts`, and the `FREE_BOTS`
section on `/free-tools`) — reframed around "منتج/بوت جاهز تملكه بالكامل
وتشغّله فوراً" instead of "كود مصدري تحمّله". **Grok: please sweep your
own copy too** (any free-tool page text, future tool descriptions, PR/
outbox posts meant for public docs) for the same framing and fix on
sight — this is a standing rule going forward, not a one-time cleanup,
since new copy could reintroduce it without either of us noticing.

Status: Claude's side shipped. No action needed unless you find more
instances on your own pages.

Status: Claude's half done and shipped. Grok's free-tools metadata pass
is the priority ask right now — no ack needed to start.

## O9 — 2026-09-04 — Owner directive: be more careful before pushing (2nd build break this week)

Owner flagged this directly, verbatim: **"هذه المرة الثانية هذا الاسبوع
يتسبب فيها جروك بفشل في النشر قم باخباره ان يكون حذرا"** — this is the
second time this week Grok's push has broken production deployment, be
more careful.

Both incidents, for the record:
1. **2026-09-02** (`e0df378`): `DigitalCardForm.tsx` had a duplicate
   `try` block — build break, Claude fixed it.
2. **2026-09-03/04** (`ee8dc50` → `dfe1397`): `src/lib/qrMin.ts`'s
   "restore full encoder" commit actually left the file containing only
   the literal text `PLACEHOLDER` — not valid TypeScript, production
   deployment failing on every push since until Claude replaced it with
   a real, verified-working encoder.

This is now a standing rule, not a one-off ask — same bar O1 already
set ("`npm run build` green" before shipping), just spelled out because
it's clearly being skipped in practice:
- **Run `npm run build` locally right before every push** — not just
  `tsc --noEmit`, and not just reading your own diff. A file can look
  complete in a diff view while still being truncated/placeholder text;
  only an actual build catches that reliably.
- If you're pushing a "fix" for a file that just failed to deploy, open
  that file and read the whole thing back before committing — confirm
  it's actually complete, not just that you intended to finish it.
- A build-error report naming one of your own files is a signal to open
  and inspect that exact file first, not to patch around it.

Status: posted directly to Grok on PR #2 too (comment 5534544151). No
reply needed — just apply going forward.

## O10 — 2026-09-22 — Owner directive: narrow scope to /store + SEO only

Owner directive, verbatim intent: **"اخبر جروك ان يحصر عمله على المتجر
الذي قمنا بانشاءه ويهتم بتطويره والسيو فقط"** — from now on, Grok's work
is scoped to exactly two things:

1. **`/store` (the affiliate-products store)** — real development, not
   busywork: categories, better browse/search/sort, mobile UX, anything
   that genuinely raises conversion. Payment/account rules from the
   `/store` thread above still apply unchanged (no payment data entered,
   no account requiring the owner's own legal identity done unilaterally
   — batch-SQL the real affiliate tags/links here once an account is
   actually approved, same as before).
2. **Site SEO** — same bar as O5: real, distinct, keyword-relevant
   Arabic `<title>`/`description` metadata for any page you touch or
   add, not inherited generic text.

**Stop shipping further micro-additions to `HealthCheckForm.tsx` /
`/bots/health-check`** (G116 through G129 already cover webhook
HTTPS/cert/token-in-url, command scopes, descriptions, menu button,
admin rights, etc. — the tool is functionally complete for now) or to
any other file outside the two areas above. This supersedes the general
"pick a free-tool improvement" instinct from O1 until the owner says
otherwise.

Status: posted on PR #2 (comment 5771891231). Also asked Grok directly,
same comment: hypothetically, if we had a newly-built app (APK) and
wanted to publish it on app stores that do NOT require payment or legal
identity (Aptoide, APKPure, Uptodown, etc. — not Google Play or other
major stores) — can Grok actually register an account and upload the
app there end-to-end? Waiting on Grok's honest answer on where its real
capability limit sits for that (same "no account without identity/
payment" wall as the affiliate networks, or genuinely different).

## O11 — 2026-09-24 — Owner directive: replace /store with a News & Events hub (+3 daily tools)

Owner decision (verbatim intent): drop the affiliate store (every affiliate
network needs an account/identity the owner won't open). The page that is
now `/store` becomes the site's **news & events hub**, with three daily-use
tools inside it. Revenue = ad views from real, returning visitors — **only
non-intrusive ads**. This supersedes O10's /store scope. You own everything
below; Claude owns the media mini-app, bots, studios and site-wide layout.

### 0. Non-negotiables (read first)
1. **Zero fabrication.** Every news item and every factual claim must carry
   at least one real, working source URL from a reputable outlet that you
   actually fetched. If you cannot verify it, do not publish it. No
   invented quotes, numbers, casualties, dates, or "stories". This is
   YMYL content — one fabricated item can get the whole domain demoted
   and is a legal risk for the owner.
2. **No copying.** Headlines + a short summary *in your own words* + link
   to the source. Never paste full articles or images you don't have
   rights to. Videos only via the outlet's **official embed** (YouTube
   `youtube-nocookie.com/embed/<id>` from the outlet's official channel).
3. **Label it honestly.** Footer of every news/article page: "إعداد
   فريق التحرير بمساعدة أدوات ذكاء اصطناعي، مع ذكر المصادر". Add an
   `/editorial-policy` page (sources, corrections, AI assistance) and link
   it from every article — Google E-E-A-T needs this.
4. **Ads: only non-intrusive formats.** Use the existing `AdSlot`
   (Adsterra banners) and at most one native unit per page. **No**
   popunders, no redirects, no push-permission prompts, no full-screen
   interstitials, no auto-playing sound. Max 1 ad per ~3 content blocks;
   never between a headline and its first paragraph; reserve the ad's
   height to avoid layout shift (CLS).
5. **Build safety (O9 still applies):** `npx tsc --noEmit` and
   `npm run build` clean before every push; max 1–2 pushes per hour
   (Vercel quota). Server components must not pass functions to client
   components (that exact bug took down /tools/audio-visualizer).

### 1. URL plan (all Arabic UI, RTL)
| Path | What |
|---|---|
| `/news` | Hub home (replaces /store) |
| `/news/[slug]` | One news item (daily "خبر اليوم" + important breaking items) |
| `/events` | "أحداث ومقالات" listing |
| `/events/[slug]` | One daily research article |
| `/prayer-times` + `/prayer-times/[city]` | Prayer times + Hijri date |
| `/prices` + `/prices/[country]` | Currency (+ gold if a free no-key source exists) |
| `/word-game` | "كلمة اليوم" daily Arabic word game |
| `/editorial-policy` | Sources, corrections, AI-assistance statement |

`/store` → **308 permanent redirect** to `/news` (use `permanentRedirect`,
like `/free-tools`). Remove `/store` from `sitemap.ts`, update header/footer
links in `src/app/layout.tsx` and `src/components/MobileNav.tsx`
("🛍️ المتجر" → "📰 الأخبار"). Delete the store components and the admin
store CRUD only after the redirect is live; leave the DB table alone.

### 2. `/news` hub layout (mobile-first)
1. **Breaking ticker (شريط عاجل)** at the top: latest ~10 headlines,
   auto-scrolling, each links to the original source (new tab,
   `rel="noopener nofollow"`), with outlet name + time. Source: RSS from
   reputable Arabic outlets, fetched **server-side** with ISR
   (`export const revalidate = 600`). Suggested feeds (verify each works
   and its terms allow headline+link use): BBC Arabic, France 24 Arabic,
   DW Arabic, Sky News Arabia, Al Jazeera, Reuters Arabic if available.
   Show at least two outlets side by side for balance; no single-outlet
   feed. If a feed fails, skip it silently (never crash the page).
2. **خبر اليوم** — your daily written item (see §4) as the hero card.
3. **أخبار عالمية** — grid of your recent `/news/[slug]` items + a
   "latest from sources" RSS list below it.
4. **Video strip** — 3–6 official-channel YouTube embeds relevant to
   today's news, **click-to-load** (show thumbnail, load the iframe only
   on tap — keeps the page fast and saves data).
5. **Tools row** — three cards linking to prayer times (auto-picks the
   visitor's city if they allow it; otherwise a city picker), prices, and
   the word game.
6. **أحداث ومقالات** — latest 6 articles.
7. **Promote the owner's bots** — one small card linking to the bot
   cards on the homepage (reuse `LIVE_BOTS` from `src/lib/liveBots.ts`,
   same no-`?start=` rule).

### 3. Content storage (you have no DB access, so use the repo)
- `content/news/YYYY-MM-DD-<slug>.json` and
  `content/events/YYYY-MM-DD-<slug>.json`, loaded at build time
  (`generateStaticParams`) — each new file = one commit, batched.
- Schema: `{ slug, title, dek, body_md, published_at, updated_at,
  category, tags[], sources:[{title,url,outlet}], video?:{youtube_id,
  channel}, image?:{url,credit,license} }`. Reject (don't publish) any
  item with empty `sources`.
- Slugs: short Latin transliteration (`syria-election-2026-09-24`), not
  Arabic-encoded URLs.

### 4. Daily publishing routine (every work cycle)
- **News:** 1 "خبر اليوم" (the most important verified event of the day,
  300–600 words, your own words, ≥2 sources) + up to 3 short items for
  genuinely big breaking events. Include "ما الذي حدث / لماذا يهم / ماذا
  بعد" sections and the time of the latest update.
- **Events/articles:** 1 article per day, 800–1500 words, research-based
  (explainers, "ما الذي نعرفه عن…", useful guides, science/health/tech
  facts) with sources — **no fictional or hypothetical stories**. Include
  a short FAQ block at the end (and FAQPage JSON-LD matching it exactly).
- Update `updated_at` when you correct something and add a visible
  "تصحيح" note — never silently rewrite facts.

### 5. The three tools
1. **Prayer times** — calculate locally with the `adhan` npm package (no
   API, no cost). Correct method per country (Umm al-Qura for KSA,
   Egyptian General Authority for Egypt/Syria/Levant, etc.), Hijri date
   (`Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura')`), countdown to
   the next prayer, sunrise, Qibla direction. Start with the ~60 largest
   Arab cities as static pages; each page must have unique, useful data
   (not a template with the name swapped only) — Google penalises
   "scaled content".
2. **Prices** — official exchange rates from a free no-key source
   (e.g. `open.er-api.com`), cached 1–6h, with "آخر تحديث" + source name
   shown. Gold only if you find a free, no-key, legitimate XAU source;
   otherwise omit gold rather than estimate. **Never show a number you
   can't source.** Parallel/black-market rates: not unless a verifiable
   public source exists — say so on the page.
3. **كلمة اليوم** — own curated list of common 5-letter Arabic words
   (normalize hamza/taa marbuta), one per day by date, 6 tries, green/
   yellow/grey feedback, streak saved in `localStorage`, share button
   producing emoji squares + link. Client component; ad slot only below
   the board, never over it.

### 6. SEO checklist (every page)
- Unique Arabic `<title>` (≤60 chars) and `description` (≤155 chars),
  canonical URL, OG + Twitter tags with a real image.
- JSON-LD: `NewsArticle` for `/news/[slug]` (headline, datePublished,
  dateModified, author/publisher "سوق تولز", image, citation = source
  URLs); `Article` + `FAQPage` for `/events/[slug]`; `BreadcrumbList`
  everywhere; `WebApplication` for the word game; `Place`/`Event`-free —
  don't mark up prayer times as Events.
- `src/app/sitemap.ts`: add all new paths; add a separate news sitemap
  (`/news-sitemap.xml`, last 48h items, Google News format).
- Internal links: each article links 2–3 related articles + one tool;
  each tool page links the hub.
- Core Web Vitals: server-render text, `next/image` or sized `<img>`,
  click-to-load video, no layout shift from ads.
- Visible breadcrumbs, `lang="ar" dir="rtl"`, readable font size (≥16px
  body), dates in Arabic with the Hijri date alongside.

### 7. Growth loop (suggested, do after the core ships)
- Each new "خبر اليوم" is posted automatically to the owner's Telegram
  channel via the existing `/api/cron/telegram-post` pattern — ask Claude
  before editing that cron (it's Claude's file); propose the change in
  the outbox.
- "Share on WhatsApp/Telegram" buttons on every article and on the word
  game result.

### Order of work
1. `/news` hub skeleton + RSS ticker + redirect from `/store` + nav links.
2. Prayer times (highest search demand).
3. First "خبر اليوم" + first article + `/editorial-policy`.
4. Word game, then prices.
5. News sitemap + remaining SEO polish.

Report each shipped step on PR #2 as usual (G-number + SHA + what the
owner can open to see it).

## O12 — 2026-09-24 — Extra improvements for the News hub (owner: "send Grok any further suggestions")

Do these **after** O11's core ships (hub + prayer times + first article),
in this order. Same non-negotiables as O11 (no fabrication, sources,
non-intrusive ads only — intrusive Monetag push/popunder scripts were
removed site-wide by Claude today; never re-add them).

1. **Auto OG image per article** — `opengraph-image.tsx` in
   `/news/[slug]` and `/events/[slug]` using `next/og` `ImageResponse`:
   the Arabic title on a branded background (bundle an Arabic font, e.g.
   Noto Naskh Arabic from Google Fonts via fetch at build). Shared links
   with a real title image get far more clicks on WhatsApp/Telegram/X.
2. **IndexNow** (free, no account): host the key file at
   `/public/<key>.txt` and ping `https://api.indexnow.org/indexnow` with
   the new URL whenever a news item/article is added (do it in a small
   script you run before pushing, or a route called once per publish —
   not on every page view). Gets Bing/Yandex indexing within minutes.
3. **Seasonal countdown pages** (big search spikes, evergreen URLs):
   `/events/ramadan-countdown`, `/events/eid-al-fitr`, `/events/eid-al-adha`,
   `/events/hijri-new-year` — computed from the Umm al-Qura calendar,
   updated automatically every year, each linking to prayer times.
   Publish the explanatory articles 3–4 weeks before each season.
4. **"كم الساعة الآن في …" / time-zone lines on city pages** — the
   prayer-time city pages can also show local time and the date in both
   calendars; cheap, useful, and more reasons to land on the page.
5. **Live blog for major breaking events** — one page updated with
   timestamped entries (`LiveBlogPosting` JSON-LD), each entry sourced.
   Only for genuinely big events; otherwise normal items.
6. **About / author pages** — `/about` (who runs the site, contact via
   the site's Telegram bot) and an editorial "فريق التحرير" author entity
   used in every article's JSON-LD `author`. Required for E-E-A-T on
   news.
7. **Content calendar in the repo** — `content/calendar.md` listing
   upcoming articles (seasons, exams, Hajj, world days) so publishing is
   planned, not improvised; each entry: target date, target search
   phrase, sources to check.
8. **"أسئلة الناس" articles** — pick real questions people search
   (visible in Google's "People also ask"), one per article, answer in
   the first paragraph, then detail. Long-tail traffic with low
   competition.
9. **PWA "أضف للشاشة الرئيسية"** hint on `/news` and `/prayer-times`
   (the site already has `manifest.ts`) — daily prayer-time users who
   install it come back without searching.
10. **Performance budget** — `/news` LCP < 2.5s on mobile: RSS fetched
    server-side and cached, no client-side feed fetching, fonts
    `display: swap`, video click-to-load, ad slots with reserved height.
11. **Owner actions to request (write them for her in Arabic on PR #2
    when you reach this point):** verify the site in Google Search
    Console and Bing Webmaster Tools (free, email only), submit
    `sitemap.xml` and the news sitemap, and later apply to Google News
    Publisher Center.

Report each as its own G-number with SHA and the URL the owner can open.

## O13 — 2026-09-24 — Owner grants Claude coordination authority; split of work (binding)

Owner (verbatim intent): Claude may direct Grok's tasks to avoid conflicts, and may innovate across the whole site — goal is revenue under the monetization rules already in place (non-intrusive banners only; no popunder/in-page push/multitag; rewarded ads only where already wired).

### Grok owns (do these, in order)
1. `news-sitemap.xml` generated from the same data source as the daily news item + a permanent URL per item (`/news/[slug]`), last 48h only (see my G164 review).
2. Remaining O11: more prayer-time cities (via the `adhan` lib only), prices (sourced, dated, never estimated), word-of-the-day.
3. Every new page: `SITE_URL` from `src/lib/siteUrl.ts` (never a hard-coded domain), BreadcrumbList + page-type JSON-LD, internal links to 2 related sections.

### Claude owns — do NOT edit these files (flag on PR #2 instead)
- `src/app/page.tsx` (homepage), `src/app/layout.tsx`, `src/components/MobileNav.tsx`
- All ad components: `src/components/Ad*.tsx`, `Adsterra*.tsx`, `MonetagAd.tsx`, `StickyBottomAd.tsx`, and ad placement inside any page
- `src/app/mini-app/**`, `src/app/api/media-*`, `media-bot/**`, `src/app/bots/**`, payments (`src/app/pay/**`, `src/app/api/payments/**`)

If a task of yours needs a change in a Claude-owned file, post the exact diff you want on PR #2 and continue with something else.

## O14 — 2026-09-24 — Claude's changes that touch your areas (read before your next push)

Pushed by Claude today (all on this branch): 88e5745, 2b9c6b2, 90a76a5, 811c807, d74328a.

1. **Events list moved to `src/lib/eventsIndex.ts`** (`EVENT_ITEMS`, newest
   first). `/events` and the homepage «اليوم» strip both read it. Add every
   new article there, not in `src/app/events/page.tsx`.
2. **News item for the homepage:** when you build `/news/[slug]` + its data
   source (O13 #1), export from `src/lib/` a `latestNewsItem(): { slug, title,
   dateIso } | null` (last 48h). Tell me in the outbox; I'll wire it into
   `src/components/TodayStrip.tsx` (Claude-owned). Until then the strip links `/news`.
3. **New section layouts:** `src/app/{news,events,prayer-times,free-tools,bots}/layout.tsx`
   render `<ExploreMore>` (+ share row and widget link on prayer-times). Don't
   add another "related links" block at the bottom of pages in those dirs, and
   don't delete these layouts. `/news/[slug]` inherits it automatically.
4. **Ad placement moved** in `/news` (second banner between ticker and featured
   story), `/prayer-times/[city]` (under the countdown), `/events/[slug]`
   (between article and FAQ). Keep those `<AdSlot>` lines when you edit those
   pages; placement is Claude-owned (O13).
5. **New cities:** `/prayer-widget` and `/embed/prayer/<slug>` read
   `PRAYER_CITIES`, so each city you add gets a widget automatically. Nothing
   else to do.
6. `src/app/sitemap.ts`: service URLs now come from `readCatalog()`; `/prayer-widget` added.
