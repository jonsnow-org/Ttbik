# تنبيه لجلسة أثر ولجروك ولأي جلسة أخرى: فرع كود شام (2026-10-05)

**بأمر صريح من المالكة.** كود نموذج «شام» (مجلد `ai-system/` وملفات `.github/workflows/sham-*.yml`) ومهامّه المجدولة على GitHub **لا تتبع هذا الفرع**، بل الفرع **`sham-main`**.

## ماذا حدث
- هذا الفرع (`claude/free-services-marketplace-h6rwk2`) هو الفرع الافتراضي للمستودع، وهو فرع جلسة أثر. GitHub لا يشغّل الجداول الزمنية (`cron`) إلا من الفرع الافتراضي، فبقيت **أربعة ملفات** تعريف فقط هنا:
  `.github/workflows/sham-collector.yml` · `sham-cpu-trainer.yml` · `sham-merge-eval.yml` · `sham-status.yml`
- كل واحد منها يبدأ بـ `actions/checkout` مع `ref: sham-main`، أي يسحب كود شام من فرعه الخاص. لذلك **لا حاجة لدمج كود شام في هذا الفرع بعد الآن.**
- بقيت نسخ قديمة من ملفات شام هنا (`ai-system/`…): هي نسخة قديمة غير مستعملة في التشغيل، **لا تُحذف ولا تُحدَّث** (لا لجلسة أثر ولا لجروك) إلا بطلب المالكة.

## القواعد
1. **جلسة أثر:** لا تلمسي الملفات الأربعة ولا `ai-system/` ولا `sham-*`. هذا تنبيه متبادل: `CLAUDE.md` يحمي ملفات أثر منّا، وهذا الملف يحمي ملفات شام منكم.
2. **جروك:** لا تعدّل شيئاً من ذلك. طلبات الدمج الخاصة بشام تستهدف `sham-main` ولا تُدمج إلا بموافقة 🟣 CLAUDE-SHAM-MODEL (فترة المراقبة أسبوع على الأقل).
3. **لا تغيّروا اسم `sham-main` ولا تحذفوه ولا تدفعوا إليه** (حذفه يوقف كل مهام النموذج المجدولة).
4. أي تغيير مطلوب على هذه الملفات الأربعة يمر عبر 🟣 CLAUDE-SHAM-MODEL بإذن المالكة.

---
Notice to all sessions: Sham model code and its scheduled GitHub jobs run from branch **`sham-main`**. Only four thin workflow files live on this (Athar's, default) branch because GitHub runs `cron` only from the default branch; each checks out `sham-main`. Do not edit, delete or "sync" them, `ai-system/`, or `sham-*` files, and do not push to or delete `sham-main`, without the owner's explicit request. The old `ai-system/` copies here are unused leftovers: leave them.
