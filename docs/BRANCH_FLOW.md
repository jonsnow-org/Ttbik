# Working on two branches without surprises / العمل على فرعين بلا مفاجآت

Why this note exists (2026-11-01): the sync PR `main -> claude/free-services-marketplace-h6rwk2` (#623) went red because the production branch carried three commits (#619-#621) that `main` did not have yet. CI tests the *merged result*, so the two sessions' work collided in a test. Nothing was lost; the steps below keep it from happening again.

## The two branches
- `main` : Oracle follows it. Fix-rounds, supervisors and most PRs land here.
- `claude/free-services-marketplace-h6rwk2` (production, the default branch) : Vercel follows it, and **GitHub only runs scheduled workflows and cron from it**. Sessions that ship Nova/Sham work often push here directly, and that is fine.

## Routine for a session that pushed straight to production
1. Right after the push, open "Merge the production branch into main" (production -> main, **merge commit**). Now `main` has everything production has.
2. If you changed a workflow, a cron or a supervisor under `.github/` or `scripts/`, it only starts running once it is on production, so sync it the same day.

## Routine for a session that merges to main
1. Before opening `main -> production`, run `git fetch` and merge production into main first (step 1 above). Then the sync PR only carries your own change.
2. Open **one** sync PR per batch (Vercel builds are rate limited) and merge it with a **merge commit**, not squash, so both branches keep the same history.
3. The sync PR's CI runs on the merged tree. If one check is red: read which test, check whether a production-only commit is missing from `main` (`git log main..origin/claude/free-services-marketplace-h6rwk2`), merge it into main, push, and let CI run again. Re-run a failed job once at most; a second failure is real.

## Writing tests that behave the same everywhere
- A test that reads `process.env` (Studio URLs, tokens, flags) sets or deletes the variables it needs in `beforeEach` and restores them in `afterEach`, so it gives the same result on a laptop, on CI and in a merged tree.
- Tests of the same module in two sessions: add new `test(...)` blocks at the end of the file in separate commits, or use a new file; this avoids merge conflicts in the test file.

## Before and after a sync
- Before: run the CI list from `.github/workflows/ci.yml` for the files you touched.
- After: open `Supervisor report: <section>` issues (they update by themselves) and the Vercel deployment state; a build takes a few minutes before the new code answers.
- To pause the repair bots while you work, open an issue with the label `bots-pause` and close it afterwards.

---

# بالعربية (مختصر)
- فرعان: `main` (يتبعه Oracle) والفرع الافتراضي (يتبعه Vercel، ومنه فقط تعمل الجداول والـcron).
- من دفع مباشرة إلى فرع الإنتاج: يفتح فورًا طلب «دمج الإنتاج في main» بدمج عادي (merge commit).
- من يدمج في main: يدمج الإنتاج في main أولًا ثم يفتح طلبًا واحدًا لكل دفعة من main إلى الإنتاج بدمج عادي لا squash.
- فحص أحمر في طلب المزامنة: اقرأ الاختبار الفاشل، وابحث عن تعديل موجود في الإنتاج وغائب عن main، ادمجه في main ثم أعد الفحص. أعد تشغيل الفحص الفاشل مرة واحدة فقط.
- الاختبارات التي تقرأ متغيرات البيئة تضبطها وتستعيدها داخل الاختبار نفسه.
- ملفات `.github/` و`scripts/` لا تعمل مجدولة إلا بعد وصولها للفرع الافتراضي، فزامنها في اليوم نفسه.

---

## The Oracle path: what the alert means and what to do / مسار Oracle
"⚠️ Oracle is not answering; the gate is serving from the Vercel standby" is sent when one request had to be answered by Vercel. The visitor never sees an error. Since 2026-11-02 the gate asks Oracle once more (400 ms later) for read-only requests, so a one-second blip (sslip.io DNS answering late = Cloudflare 530/1016) no longer triggers the switch or the message.

1. **Check first**: `GET <gate>/api/ops/oracle-status` shows the commit Oracle runs and `report_age_min`; `GET https://89-168-89-15.sslip.io/api/health` answers 200 when the site container is up. If both are fine, nothing needs doing: it was a blip.
2. **Merges that rebuild Oracle** are those touching `src/`, `public/`, `prisma/`, package files, `next.config.mjs`, `deploy/oracle/` or `deploy/hosting/`; docs-only and `.github/` changes do not. While it builds, the old container keeps serving and is replaced at the end (a few seconds). Batch changes into one merge, and avoid merging to `main` in the middle of a long Nova/Sham task (the updater waits up to 10 minutes for running tasks).
3. **Down for more than 15 minutes**: open `/admin` -> «🌐 الاستضافة» and choose Vercel only (the standby carries everything), then look at the server: `docker compose ps`, `docker compose logs --tail 100 site caddy` and the files `site_status` / `update.log` in the agent state folder. A failed build leaves the previous container running; the bot message says so.
4. **Disk**: the watchdog prunes Docker build cache at 75% and tells the owner at 90%; a full disk is the usual reason a rebuild fails.
5. After the cause is fixed, switch the gate back to Auto («تلقائي») so Oracle is tried first again.
6. The gate worker deploys from `main` (Workers Builds on `cloudflare/site-gate`); run `node cloudflare/site-gate/selftest.mjs` before merging a change to it.
=======
# Working on two branches without surprises / العمل على فرعين بلا مفاجآت

Why this note exists (2026-11-01): the sync PR `main -> claude/free-services-marketplace-h6rwk2` (#623) went red because the production branch carried three commits (#619-#621) that `main` did not have yet. CI tests the *merged result*, so the two sessions' work collided in a test. Nothing was lost; the steps below keep it from happening again.

## The two branches
- `main` : Oracle follows it. Fix-rounds, supervisors and most PRs land here.
- `claude/free-services-marketplace-h6rwk2` (production, the default branch) : Vercel follows it, and **GitHub only runs scheduled workflows and cron from it**. Sessions that ship Nova/Sham work often push here directly, and that is fine.

## Routine for a session that pushed straight to production
1. Right after the push, open "Merge the production branch into main" (production -> main, **merge commit**). Now `main` has everything production has.
2. If you changed a workflow, a cron or a supervisor under `.github/` or `scripts/`, it only starts running once it is on production, so sync it the same day.

## Routine for a session that merges to main
1. Before opening `main -> production`, run `git fetch` and merge production into main first (step 1 above). Then the sync PR only carries your own change.
2. Open **one** sync PR per batch (Vercel builds are rate limited) and merge it with a **merge commit**, not squash, so both branches keep the same history.
3. The sync PR's CI runs on the merged tree. If one check is red: read which test, check whether a production-only commit is missing from `main` (`git log main..origin/claude/free-services-marketplace-h6rwk2`), merge it into main, push, and let CI run again. Re-run a failed job once at most; a second failure is real.

## Writing tests that behave the same everywhere
- A test that reads `process.env` (Studio URLs, tokens, flags) sets or deletes the variables it needs in `beforeEach` and restores them in `afterEach`, so it gives the same result on a laptop, on CI and in a merged tree.
- Tests of the same module in two sessions: add new `test(...)` blocks at the end of the file in separate commits, or use a new file; this avoids merge conflicts in the test file.

## Before and after a sync
- Before: run the CI list from `.github/workflows/ci.yml` for the files you touched.
- After: open `Supervisor report: <section>` issues (they update by themselves) and the Vercel deployment state; a build takes a few minutes before the new code answers.
- To pause the repair bots while you work, open an issue with the label `bots-pause` and close it afterwards.

---

# بالعربية (مختصر)
- فرعان: `main` (يتبعه Oracle) والفرع الافتراضي (يتبعه Vercel، ومنه فقط تعمل الجداول والـcron).
- من دفع مباشرة إلى فرع الإنتاج: يفتح فورًا طلب «دمج الإنتاج في main» بدمج عادي (merge commit).
- من يدمج في main: يدمج الإنتاج في main أولًا ثم يفتح طلبًا واحدًا لكل دفعة من main إلى الإنتاج بدمج عادي لا squash.
- فحص أحمر في طلب المزامنة: اقرأ الاختبار الفاشل، وابحث عن تعديل موجود في الإنتاج وغائب عن main، ادمجه في main ثم أعد الفحص. أعد تشغيل الفحص الفاشل مرة واحدة فقط.
- الاختبارات التي تقرأ متغيرات البيئة تضبطها وتستعيدها داخل الاختبار نفسه.
- ملفات `.github/` و`scripts/` لا تعمل مجدولة إلا بعد وصولها للفرع الافتراضي، فزامنها في اليوم نفسه.
