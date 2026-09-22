# Claude's build queue — bot-platform features

Owner directive (2026-09-02): while the owner is away, work through this
list one item per cycle — plan briefly, implement fully (schema + logic +
idempotent SQL migration + typecheck/build clean), commit, push, mark it
done below, move to the next. Always run a full error-check pass
(`npx tsc --noEmit -p .` and `npm run build`) first and fix anything found,
even if it means skipping a day's new feature to just ship the fix.

This is Claude's own queue — separate from Grok's website-tools assignment
in `docs/agent-outbox.md` (task O1). No overlap: everything here extends
the Prisma+grammy bot engine (`adBotLogic.ts`/`matchBotLogic.ts` and
siblings), which Grok is barred from touching.

Excluded on purpose (owner: avoid anything that needs the owner to pay for
a third-party API): AI image generation, AI document Q&A, PDF↔Word
conversion via a paid conversion API, plagiarism checking.

## Queue (in priority order)

- [x] **0. Created-bots tracking panel inside Super Admin** (owner directive,
      2026-09-03; shipped 2026-09-16) — `/admin/platform` lists every `Bot`
      row (masked token, owner id, template, created_at, totalRevenue,
      ownerBalance, isActive) via `GET /api/admin/bots`, with a per-row
      disable/enable toggle (`PATCH /api/admin/bots/[id]`) flipping
      `Bot.isActive` — the webhook handler
      (`src/app/api/telegram/[botId]/route.ts`) already refuses any update
      for an inactive bot, verified, no change needed there. Linked from
      the main `/admin` dashboard.
      **Delete deliberately NOT built**: the backlog's cascade assumption
      was wrong — `Ad`/`User`/`Transaction` relations have no
      `onDelete: Cascade` in the real schema (default RESTRICT), so a raw
      delete throws a foreign-key error, and forcing a real cascade would
      irreversibly destroy real financial history. Needs an explicit
      owner decision on what happens to a deleted bot's existing
      Ads/Users/Transactions before this is safe to build. Disabling
      already fully covers "shut this down" without that risk.
- [ ] **0b. Paid features inside the owner's own MARRIAGE_BOT instance**
      (owner directive, 2026-09-03) — MARRIAGE_BOT itself stays exclusively
      the owner's private bot, never sold or activated for anyone else
      (see AGENT_BUS.md Product rules), but the owner wants to sell
      in-bot upsells to that bot's own users (exact features TBD with the
      owner — a likely candidate is a paid profile boost/priority
      matching, but confirm before building). Pay for these through the
      SAME payment rails already live on the platform (NOWPayments/
      central-wallet — src/lib/nowpayments.ts, the same pattern
      matchBotLogic.ts's users would already be near via any existing
      wallet flow), not a new payment mechanism — owner was explicit that
      all payment goes through what already exists, with only the
      $100 AD_BOT activation purchase as the one different (manual,
      fixed-price, internally-verified-token) case.
- [ ] **2. Anonymous confessions/questions box bot** — new template
      (`CONFESSION_BOT`?). Each user gets a shareable link; senders stay
      anonymous. Free tier + a paid unlock (reveal-sender / unlimited
      replies) via the existing NOWPayments flow.
- [ ] **3. Name-compatibility ("نسبة التوافق") bot** — simple deterministic
      hash-based percentage between two names, shareable result card.
- [ ] **4. Personality-quiz bot** — static question banks, shareable result
      image/text, no AI needed.
- [ ] **5. Daily-streak challenge bot** (fasting/prayer/reading/exercise) —
      streak counter + daily reminder + social share of the streak.
- [ ] **6. Prayer-times / dhikr reminder bot** — free, computed offline or
      via a free prayer-times API, no ongoing cost.
- [ ] **7. Greeting-card generator bot** — canvas/sharp-based text-over-
      template image generation (no AI), seasonal templates.
- [ ] **8. Crypto price-alert bot** — free-tier price API (e.g. CoinGecko
      free), user sets a threshold, gets pinged.
- [ ] **9. Escrow / secure buy-sell bot** — reuses the existing TON hot
      wallet (`ton-service.ts` — read-only reuse, no edits to that file
      without a dedicated plan) to hold funds until the buyer confirms
      receipt. Higher complexity — tackle after 1-8 are solid.
- [ ] **10. Group trivia/quiz competitions bot** — for group/channel
      owners, points-based leaderboard, gated activation like AD_BOT's
      creator codes.
- [ ] **11. Complete the STORE template** — rebuilt fresh on the
      Prisma+grammy engine (the old Supabase-JS STORE bot is gone).
- [ ] **12. Complete the HOSPITAL template** — same, rebuilt fresh.

## Done

- **1. Unified points/rewards ledger across all bots** (shipped 2026-09-22)
      — `PlatformPoints` (one balance per `tgUserId`, cross-bot) +
      append-only `PlatformPointsTransaction` ledger in
      `prisma/schema.prisma`, with `earnPoints()`/`spendPoints()`/
      `getPointsBalance()`/`getPointsHistory()` in
      `src/lib/platformPoints.ts` (each mutation atomic via
      `prisma.$transaction`, `spendPoints` throws `InsufficientPointsError`
      on an insufficient balance). Foundational only, as scoped — no bot
      template earns/spends against it yet; items 2+ call into it as they
      land. ⚠️ Owner needs to run `prisma/migration_32_platform_points.sql`
      in Supabase's SQL Editor.
