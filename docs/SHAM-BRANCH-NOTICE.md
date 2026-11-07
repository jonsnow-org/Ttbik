# تنبيه: كود شام ودفاتره (مُحدَّث 2026-11-06)

> **تحديث المالك (2026-11-06): لا يوجد «ممنوع اللمس» إلا مشروع أثر.** كل ما في هذا الملف عن حماية ملفات شام من جلسة أثر لم يعد ساريًا؛ شام ودفاتره مفتوحة للعمل لكل جلسة هنا.

## الحقائق التقنية (تبقى صحيحة)
- كود نموذج «شام» (مجلد `ai-system/`) وبعض مهامّه المجدولة تعمل من فرع **`sham-main`**، وبقيت أربعة ملفات تعريف فقط على الفرع الافتراضي لأن GitHub لا يشغّل الجداول (`cron`) إلا من الفرع الافتراضي:
  `.github/workflows/sham-collector.yml` · `sham-cpu-trainer.yml` · `sham-merge-eval.yml` · `sham-status.yml`
- كل واحد منها يبدأ بـ `actions/checkout` مع `ref: sham-main`.
- نسخة `ai-system/` الموجودة على هذا الفرع **مستعملة فعلاً**: دفاتر Kaggle تسحب كودها بـ `git clone --branch claude/free-services-marketplace-h6rwk2`. **لا تُحذف**: حذفها يوقف دفاتر التدريب.

## القواعد الحالية (2026-11-06)
1. `ai-system/` و`sham-*` مفتوحة للعمل — عدّلها وأصلحها وأعد تشغيلها. لا تُحذف نسخة `ai-system/` لأن الدفاتر تسحبها.
2. لا تغيّر اسم `sham-main` ولا تحذفه ولا تدفع إليه بالقوة (حذفه يوقف المهام المجدولة).
3. القواعد الحيّة الوحيدة: لا أسرار في المستودع، ولا تلمس مشروع أثر وعقوده الحيّة.

---
Notice to all sessions (updated 2026-11-06): the owner's order removed every hands-off rule except Athar. Sham model code (`ai-system/`) and its scheduled jobs run from branch **`sham-main`**; four thin workflow files live on this default branch because GitHub runs `cron` only from the default branch, each checking out `sham-main`. The `ai-system/` copy on this branch is NOT a leftover: Kaggle notebooks `git clone` this branch, so deleting it stops the training notebooks. You may now edit, fix and re-run all of it; just never delete the `ai-system/` copy and never force-push to `sham-main`.

## 2026-11-07 — one source of truth
Scheduled Sham jobs (`sham-*.yml`), the restarter and the Lightning job now check out the production branch (`claude/free-services-marketplace-h6rwk2`) instead of `sham-main`. `sham-main` had fallen ~1900 commits behind (the merge job ran stale code and failed for days). `sham-main` is now only a legacy copy used by Oracle's sham runner and two notebook-push workflows (`sham-arabic-sft-push`, `sham-repair-remerge-push`); do not rely on it for new work.
