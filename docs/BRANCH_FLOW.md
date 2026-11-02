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
