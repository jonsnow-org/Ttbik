# Agent bus — Claude + Grok

Live channel: https://github.com/jonsnowx1r-lab/Ttbik/pull/2
State: `docs/agent-state.json`
Inbox (Grok → Claude while Grok is offline): `docs/agent-inbox.md`
Outbox (Claude → Grok while Grok is offline): `docs/agent-outbox.md`

Not a daemon. Files persist work across disconnects. That is the retrospective link.

## Cycle (every scheduled Grok run)
1. Read `agent-state.json`, `agent-outbox.md`, last 8 PR #2 comments.
2. Ignore comment ids ≤ `last_seen_comment_id` and anything in `resolved`.
3. If outbox has an open task in Grok files: implement it, push, mark done in outbox + state.
4. If no outbox task: pick ONE open site improvement from `open` or invent one small paid tool idea, write a short proposal in inbox + one PR comment.
5. If a proposal is already waiting with no Claude ack: do not spam. Stop.
6. Update `last_seen_comment_id` and `updated_at` even when you only read.

### Standing rule (owner directive, 2026-09-04) — always flag a new SQL migration by name
Any task that adds/changes a database table, column, index, or grant —
whichever side (Prisma `prisma/migration_N_*.sql` or Supabase
`supabase/*.sql`) — MUST be called out **explicitly and by filename** in
both places:
1. The PR #2 completion comment: a clear line like "⚠️ يتطلب تشغيل SQL
   جديد: `prisma/migration_N_....sql`" — not just buried inside the code
   diff or a file's own header comment.
2. The `status`/`resolved` line in `agent-outbox.md`/`agent-inbox.md`/
   `agent-state.json` for that task.
The owner runs these manually in Supabase's SQL Editor and has no other
way to know one is waiting — a migration file that ships without this
explicit flag is easy to miss entirely (this already happened once:
`migration_11_short_link.sql` shipped without ever being flagged as
needing a run, and separately was missing the `GRANT ... TO service_role`
line `migration_12_digital_card.sql` correctly included — the exact same
"permission denied for table" failure mode this project already hit once
before with `hosted_bots`). Always double-check a new Prisma-side
migration file ends with the same `GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE "X" TO service_role;` line the others do, and always name the
file explicitly in the completion report — every time, no exceptions.

## Ownership (updated 2026-09-05 — NOVA_BOT added, supersedes the block below)
- Claude owns and is the sole editor of the whole bot engine: `prisma/schema.prisma`
  (AD_BOT + MARRIAGE_BOT + JOBS_BOT + MEDICAL_BOT + NOVA_BOT models), `src/lib/adBotLogic.ts`,
  `src/lib/matchBotLogic.ts`, `src/lib/jobsBotLogic.ts`, `src/lib/medicalBotLogic.ts`,
  `src/lib/novaBotLogic.ts`, the entire `ai-system/` directory (separate Python
  FastAPI service — Nova AI's actual brain, deployed to Render.com, not Vercel
  and not Hugging Face Spaces — see O15 in docs/agent-state.json),
  `src/services/ton-service.ts`, `src/services/marriageTonService.ts`,
  `src/services/jobsTonService.ts`, `src/app/api/telegram/[botId]/route.ts`,
  `src/app/api/bots/deploy/route.ts`, `src/app/bots/page.tsx`, `src/app/bots/BotsDeployForm.tsx`,
  `src/app/api/cron/medical-reminders/route.ts`, every
  AD_BOT/MARRIAGE_BOT/JOBS_BOT/MEDICAL_BOT/NOVA_BOT `prisma/migration_*.sql`
  — plus site shell, admin, orders, migrations, env/Vercel as before. JOBS_BOT and
  MEDICAL_BOT are both owner-only private bots (like MARRIAGE_BOT — see Product
  rules below): never sold, never activated for anyone but the platform owner.
  NOVA_BOT is owner-only to DEPLOY (same password-gate pattern) but, once
  deployed, is a genuine public-facing product with real external end-users
  and paid subscriptions — see the NOVA AI product rule below.
- Grok implements: new standalone website tools (own page/route + own new
  Prisma models, per docs/agent-outbox.md task O1), or a brand-new bot
  template that only ADDS a sibling branch to the shared dispatcher files
  above — never edits Claude's existing branches.
- Claude supervises: any change to a file Claude owns needs a plan proposed
  in agent-outbox.md/agent-inbox.md or PR #2 first, then Claude's ack,
  before Grok pushes to it.
- Cross-file work: propose first, wait for ack, then split.

### Historical (pre-rebuild — botEngine.ts and hosted_bots no longer exist, kept for reference only)
- Grok implements: botEngine, botTemplates, tgApi, botCodes, src/app/bots/**, src/app/api/bots/**, src/app/pay/bot/**
- Claude implements: site shell, admin, orders, migrations, env/Vercel

## Product rules (resolved)
- **Owner directive 2026-09-23 — public bot cards.** The owner's own
  running bots (ads, media downloader, jobs/store, marriage, medical) ARE
  advertised publicly via `src/lib/liveBots.ts`: each card links straight
  to the bot on Telegram. What stays private is the TEMPLATE (deploying a
  copy), not the owner's live instance. Never link a card to the builder
  or template page, and never add a `?start=` payload to these links.
- No cash withdraw from hosted bots.
- Paid orderCode for create, except owner. One order = one bot.
- **AD_BOT is never sold or self-served on the website (owner directive,
  2026-09-03).** No public price, no catalog listing, no automated
  checkout — ever. Selling free/instant self-service access to it "بمجرد
  دفع مبلغ صغير" harms the business (owner's own words). It stays
  reachable ONLY the way it already is: the in-bot "أريد بوتاً مماثلاً"
  button → $100 manual bank transfer → owner's manual approval → per-buyer
  BotPurchase code. Price and payment are negotiated/settled manually,
  off-platform, by the owner — don't build an on-site price, an automated
  payment path, or an activation code that isn't gated by owner approval.
  This is why `hosted-bot-builder` was retired (see
  migration_remove_locked_code_products.sql §2b) rather than fixed to
  auto-deliver — auto-delivery is the thing that must never exist here.
- **MARRIAGE_BOT is not a product at all — it is the owner's own private
  bot, full stop (owner clarified 2026-09-03, correcting an earlier,
  wrong assumption in this file that it could be handed to "someone the
  owner trusts").** It is never sold, never activated for anyone else,
  never listed anywhere, and there is no path — paid, free, or
  by-request — for a third party to get their own instance. Its
  `MARRIAGE_BOT_CREATOR_PASSWORD` gate exists solely so the OWNER can
  redeploy their own single instance (same template, a new token) if the
  one they're currently running ever breaks or needs replacing — never
  treat a request for "access" to this template as something to fulfill.
  The owner does plan to add PAID FEATURES *inside* their existing
  MARRIAGE_BOT instance (e.g. profile boosts — exact scope TBD with the
  owner), reusing the platform's existing NOWPayments/central-wallet
  payment rails like everything else — see
  docs/claude-feature-backlog.md. That is strictly an in-bot upsell; it
  does not make the template itself sellable or deployable by anyone but
  the owner.
- **JOBS_BOT (owner spec, 2026-09-05) is the same as MARRIAGE_BOT: a
  private, owner-only bot template, never sold or activated for anyone
  else.** Job-marketplace + buy/sell store with escrow payments. Gated by
  `JOBS_BOT_CREATOR_PASSWORD` (separate env var from
  `MARRIAGE_BOT_CREATOR_PASSWORD`, though the owner may set both to the
  same value). Fully isolated financial ledger (`JobsUser.balance` +
  `JobsTransaction`) — never shares a table with AD_BOT's or MARRIAGE_BOT's
  money, same reasoning as MARRIAGE_BOT's own ledger split (see
  MatchTransaction's schema comment).
- **NOVA_BOT (owner spec, 2026-09-05) is different in kind from the three
  above: it IS meant to be a genuine public-facing product with real
  external end-users and paid subscriptions** — deploy is still gated
  owner-only (`NOVA_BOT_CREATOR_PASSWORD`, one instance, owned by the
  platform owner), but unlike MARRIAGE_BOT/JOBS_BOT/MEDICAL_BOT the bot
  itself is explicitly built to serve many outside users and monetize
  them (same commercial shape AD_BOT already has). Its actual AI logic
  is NOT in this Next.js codebase at all — it lives in a separate Python
  FastAPI service under `ai-system/`, deployed independently (Hugging
  Face Spaces free tier), talking to the same Supabase project via
  isolated `Nova*` tables. Never wire Claude's or Grok's real (paid)
  APIs into its live request path, and never claim it "merges" closed
  models (Claude/Grok/Gemini) into one network — both are false and the
  first breaks the product's $0-cost requirement; see `ai-system/README.md`
  and the honest, corrected architecture in `docs/agent-state.json` (O14).
  No automated subscription checkout — `NovaSubscription` rows start
  `PENDING_APPROVAL` and the owner flips them to `ACTIVE` manually, same
  as every other payment-adjacent flow in this project.
- Neither AD_BOT's, MARRIAGE_BOT's, nor JOBS_BOT's source/build is exposed
  anywhere for download/copy — keep it that way (unlike the free
  FAQ/auto-reply bots, which deliberately ship full source). Before
  adding any admin/debug/export endpoint that touches Bot rows, make sure
  it can't leak a working token, template code, or webhook secret to
  anyone but the owner.
- Locked-code-for-sale catalog products (order-manager-bot, ad-slot-bot,
  landing-page-generator, workflow-templates, invoice-generator,
  whatsapp-catalog) are permanently deleted, not just deactivated — the
  site sells real services, not locked code (owner directive, 2026-09-02).
  Don't re-add a "buy this code file" product.


## Rule (2026-09-24): every new Supabase table needs explicit grants

From 2026-10-30 Supabase stops auto-granting Data API access to new tables
in `public`. Every migration that creates a table must, in the same file:

    grant select, insert, update, delete on public.<table> to service_role;

Do NOT grant `anon` / `authenticated` unless the table has RLS policies
written for exactly that access. `supabase/grants_service_role_all.sql`
(run once by the owner) also sets default privileges so future tables get
the service_role grant automatically — keep adding the explicit GRANT anyway.
