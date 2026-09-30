# Backup — original prompt of Routine "Ttbik daily backlog build"

Routine id: `trig_011XXngMYPinJvTK4mMbKDnF` (daily, `0 6 * * *` UTC, fresh session each run).
On 2026-09-30 the owner put it on HOLD; its prompt was replaced with a silent
read-only instruction. To lift the hold, restore the prompt below on that Routine.

---

You are doing autonomous, unattended work on the GitHub repo jonsnowx1r-lab/Ttbik (a Next.js + Supabase + Prisma + grammy multi-tenant Telegram bot platform, hosted on Vercel). The owner is away for a while and explicitly asked for recurring work while they're gone: always check for and fix errors, and implement one backlog item per cycle, fully working, without waiting for approval. Proceed without asking questions — just do the work and end your turn when done.

Setup:
1. Call add_repo for owner "jonsnowx1r-lab", repo "Ttbik" (push access) if it isn't already attached to this session, then clone it and register the repo root per that tool's instructions.
2. Checkout branch `claude/free-services-marketplace-h6rwk2` (create it tracking origin if needed), and `git fetch origin claude/free-services-marketplace-h6rwk2` + fast-forward merge before doing anything else.
3. `npm install` if node_modules is missing, then `npx prisma generate`.

Step 1 — ALWAYS run an error-check pass first, every cycle, before anything else:
- Run `npx tsc --noEmit -p .` and `npm run build`.
- The build has one long-standing, benign, pre-existing failure signature you should ignore: "Error: supabaseUrl is required" on exactly `/api/admin/orders` and `/sitemap.xml` during static generation — this is a missing local-only env var unrelated to any real bug; every other route builds fine around it, and "✓ Generating static pages (35/35)" still appears. Anything else — a real typecheck error, a build failure outside those two routes, or those two routes failing for a NEW/different reason — is a real bug: investigate and fix it.
- If you find and fix a real error, commit and push that fix (message ending in the attribution footer below) before moving to feature work this cycle. If the fix is all you have time/scope for this cycle, that's fine — stop there.

Step 2 — Read `docs/claude-feature-backlog.md` in the repo. It has:
- A "Queue" section (unchecked items in priority order) — this is your own backlog, separate from a parallel AI agent named "Grok" who works on a different backlog (`docs/agent-outbox.md`) and territory (standalone website tools). Also skim `docs/agent-state.json`'s "open"/"resolved" arrays and `docs/AGENT_BUS.md`'s ownership table for the current state of the coordination — things may have moved since this Routine was written.
- A hard, permanent boundary: NEVER edit `src/lib/adBotLogic.ts`'s existing AD_BOT logic or `src/lib/matchBotLogic.ts`'s existing MARRIAGE_BOT logic, and never edit the existing AD_BOT/MARRIAGE_BOT branches inside `src/app/api/telegram/[botId]/route.ts`, `src/app/api/bots/deploy/route.ts`, `src/app/bots/page.tsx` — you may ADD a new sibling `else if`/`<option>` branch for a NEW template you're building, never modify the existing ones. Also never touch anything documented in `docs/agent-outbox.md`/`docs/AGENT_BUS.md` as Grok's territory.

Step 3 — Pick the next unchecked item from the Queue, in order (skip one only if it's clearly already been built by inspecting the code — check its box and move it to Done with a note instead). Write a brief plan (a few lines, in your own reasoning is fine, no need to post it anywhere), then implement it FULLY and working end-to-end, matching the quality bar already set by AD_BOT/MARRIAGE_BOT in this repo:
- Prisma schema changes in `prisma/schema.prisma` if the item needs new models — follow the existing style/conventions exactly (see the MatchUser/MatchProfile/... block for the pattern).
- A new `src/lib/<name>.ts` file for the logic (or extend an existing file you own — never AD_BOT/MARRIAGE_BOT's existing logic).
- If it's a new bot template: wire it in via a new sibling branch (never edit existing ones) in the three shared files named above.
- Run `npx prisma generate`, then `npx tsc --noEmit -p .` and `npm run build` — both must be clean (same benign-error exception as Step 1) before you commit.
- Write an idempotent SQL migration file `prisma/migration_N_<short-name>.sql` (find the highest existing `migration_N_*.sql` number in `prisma/` and use N+1), using `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — follow the exact style of the existing migration files (see `prisma/migration_10_marriage_bot_admin_inbox.sql` for the pattern), since the owner runs these by hand in Supabase's SQL Editor and needs them safe to re-run.
- If the item is too large to finish completely this cycle, do NOT leave it half-wired into any shared/dispatcher file — either ship a smaller, fully-working self-contained slice of it, or pick a smaller Queue item instead this cycle and leave the large one queued for next time. Never leave a stub, placeholder, or broken path reachable by a real user.

Step 4 — Before pushing: `git fetch origin claude/free-services-marketplace-h6rwk2` and merge (Grok's automation posts frequent small commits to `docs/agent-state.json` — these are safe, low-risk merges, just take the latest tracking fields on conflict, same pattern as resolving a diamond on that file). Then commit your work and push to `claude/free-services-marketplace-h6rwk2` with `git push -u origin claude/free-services-marketplace-h6rwk2`.

Step 5 — Edit `docs/claude-feature-backlog.md`: move the item you built from "Queue" to "Done" with a one-line summary of what was built and any SQL migration filename the owner needs to run. Commit and push that too (can be the same commit as Step 4 if convenient).

Every commit message must end with:
Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

End your turn once pushed — do not wait for a reply, the owner is away and asked for this to run unattended. If you hit something you're genuinely blocked on (not just "no error found" — an actual ambiguity needing the owner's judgment), leave a clear note at the top of `docs/claude-feature-backlog.md` describing the blocker instead of guessing, then stop for this cycle.
