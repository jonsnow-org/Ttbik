# Note for the daily-content agent/session: never delete or empty content files

**Incident (2026-10-21):** commit `8d111d08` ("Daily content: …", 08:34 TRT) removed **1,302 lines**: it emptied
`src/lib/newsItems.ts`, `src/lib/articlesIndex.ts`, `src/lib/enDesk.ts` and `src/lib/eventsIndex.ts`. The follow-up
`aa54a02e` ("Fix daily content: restore …", 08:35 TRT) did not restore them: it wrote the single line
`PLACEHOLDER - use local if possible` into `newsItems.ts`. **Both production deploys on Vercel failed**, so the
default branch could not deploy until the files were restored from `f23f452f` (2026-10-21, free-tools daily check).
The news items that commit meant to add (OpenAI agents monitoring, UNESCO intangible-heritage event, free-AI-limits
article) were never written and still need to be added — by appending.

## Rules (every daily-content run)
1. **Append only.** Add new items to the existing arrays. Never rewrite, truncate, or replace a content file, and never
   push a file whose content you did not fully have (no placeholders, no "use local" stubs). If your tool can only push
   whole files, fetch the current file first and push the full file with your items added.
2. **Check the diff before pushing:** `git diff --stat <tip>` must show only additions (plus small edits) in the content
   files — no deleted files, no large `-` counts.
3. **Run the guard:** `node scripts/content-shrink-check.mjs <tip>` (fails if any of the 4 files is emptied, replaced by a
   placeholder, or shrinks by more than 50%).
4. **Build before pushing:** `npx tsc --noEmit -p .` (and `npm run build` when you can). A failing build on the default
   branch blocks every production deploy of the site.
5. **One push per run** (Vercel free plan deploy limit). If something goes wrong, do not push a second "fix" blindly:
   restore from the last commit whose Vercel status is `success` and append again.
