# بوابة شام — اقرأها قبل أن تلمس أي شيء (2026-11-02، مُحدَّث 2026-11-06)

> **الأمر الدائم من المالك:** شام القديم مسؤولية جلسة Claude الرئيسية (المشرف الأول): إصلاحه وتدريبه والإشراف عليه. عند غياب المشرف الأول يشرف عليه آخرون، **بهذه القواعد**. من لم يقرأ هذا الملف لا يعدّل شيئًا في شام.
> **(تحديث 2026-11-06):** أمر المالك ألغى كل «ممنوع اللمس» إلا مشروع أثر. شام مفتوح للعمل لكل جلسة هنا (لا إذن مسبق)، مع بقاء القواعد الهندسية والأمان في هذا الملف. `CLAUDE.md` لم يعد محميًّا وقد حُدِّث.

## ما هو شام (القديم) في سطور
- نموذج لغوي **يُدرَّب من الصفر** بمُرمِّزه الخاص (لا أوزان جاهزة من شركة). وقت كتابة الملاحظة الأولى: 12 طبقة، بُعد 768، سياق 1024 (راجع `docs/START_HERE.md` §5، ملاحظة 1).
- **يولّد الصور والصوت والفيديو من داخله**: يكتب رموز الصورة والصوت بنفسه (`ai-system/colab/sham_small/sham_studio_media.py`، ومُرمِّزا الصورة والصوت)، فلا يحتاج مولّدًا خارجيًا ولا **ترجمة**: يقرأ طلب المستخدم باللغة التي كُتب بها. (الكود: `shamMediaFastLane` في `src/lib/novaBotLogic.ts`؛ شام القديم يمرّر النص كما هو منذ الـcommit `98f3043f`.)
- يُدرَّب على دفاتر **Kaggle** (CPU) ومهام GitHub المجدولة، ويُخدَّم على **ModelScope Studio** عبر `ai-system/modelscope-sham/app.py` (واجهات مثل `chat_auto` و`generate_any` و`ask_web` و`chat_memory`).
- ذاكرة المستخدم (ذاكرة تدمر) إضافة لا تغيّر الأوزان: `ai-system/colab/sham_small/SHAM_MEMORY.md`.

## ما ليس شامًا (لا تخلطه)
| الاسم | ما هو |
|---|---|
| **Nova** | Qwen3.5-4B على llama-server، البوت العام، استوديوهاته مستقلة |
| **Sham v2** | شام + مسارات جاهزة؛ صوره من Realistic Vision V6 في استوديو خاص، وفيديوه في استوديو مستقل `sham-v2-video-server`. يترجم الوصف لأن Realistic Vision يقرأ الإنجليزية فقط |

كل نموذج مستقل في الاستدلال والوسائط (`docs/STUDIOS.md`). **لا يستعمل نموذج مولّد نموذج آخر أبدًا.**

## أين يعيش الكود (لا تنقله)
- الكود والتدريب: `ai-system/colab/sham_small/` و`ai-system/modelscope-sham/` و`ai-system/modelscope-sham-video/`.
- مهام GitHub: `.github/workflows/sham-*.yml`. أربعة ملفات (`sham-collector` و`sham-cpu-trainer` و`sham-merge-eval` و`sham-status`) تسحب الآن كود شام من فرع الإنتاج نفسه (`ref: claude/free-services-marketplace-h6rwk2`، تحقق من 2026-11-08)؛ الفرع `sham-main` قديم لأن `cron` لا يعمل إلا من الفرع الافتراضي (انظر `docs/SHAM-BRANCH-NOTICE.md`).
- **دفاتر Kaggle تسحب `ai-system/` من فرع الإنتاج `claude/free-services-marketplace-h6rwk2` بـ`git clone`**: حذف ذلك المجلد أو كسره يوقف التدريب.
- التاريخ الكامل لما حدث: سجل git (`git log -- ai-system/`) و`docs/START_HERE.md` (حالة شام ومشاكله المعروفة).

## قواعد صارمة (من كسرها يخرّب شام)
1. **لا تغيّر المُرمِّز** (`build_general_tokenizer.py` وملفاته) ولا صيغة نقاط الحفظ ولا أبعاد النموذج: كل نقاط الحفظ والدفاتر تعتمد عليها.
2. **لا تُضعف بوابة الدمج ولا المقياس المحجوز**: `sham_merge.guarded_merge` لا يقبل دمجًا إلا إذا لم تتراجع أي مهارة في المقياس المحجوز بأكثر من التسامح. لا تدمج أوزانًا «لأنها تبدو أفضل»: لا يُستبدل وزن إلا بإثبات أنه أفضل على المقياس نفسه. (تغيير 2026-11-02: النسب الافتراضية صارت `0.01…1.0` لتجريب دمج أدق؛ **لم يُختبر بعد على تشغيل دمج حقيقي**.)
3. **لا تحذف الفرع `sham-main` ولا تدفع إليه ولا تغيّر اسمه.** ولا تحذف الملفات الأربعة الرقيقة.
4. **لا تكسر الدفاتر العاملة**: افحص أولًا ما يعمل على Kaggle (`sham-kaggle-runs.yml`) ثم عدّل.
5. **لا تطبع الأسرار ولا تنقلها** (مفاتيح Kaggle وModelScope وGitHub وSupabase).
6. **لا تستبدل مولّد شام الداخلي بمولّد خارجي ولا تضف له ترجمة.** إن كانت صوره سيئة فالحل تدريبه، لا تجاوزه. (ملاحظة حالية: مسار شام الداخلي لا يزال قيد التدريب وقد يرجع `blank_image` أو `noise_image`.)
7. **كل تغيير بإثبات تشغيل** (اختبار أو فحص حي)، ويُسجَّل في قسم «شام القديم» من `docs/START_HERE.md` (وفي رسالة الالتزام).
8. لا تدفع إلى `ai-system/**` ما يعيد نشر الاستوديوهات إلا وأنت تعرف ما سينشر (دفع ملفات معيّنة يعيد نشر استوديوهات حيّة).

## قبل أن تعدّل أي شيء (قائمة فحص)
1. اقرأ هذا الملف، ثم قسم «شام القديم» في `docs/START_HERE.md`.
2. شغّل `sham-status.yml` لتعرف أين وصل التدريب وما يعمل الآن.
3. اكتب ما ستغيّره ولماذا في ملاحظة جديدة (الحالة: بانتظار المراجعة) قبل التنفيذ.
4. نفّذ في أصغر خطوة، وأثبت أن المقياس المحجوز لم يتراجع.
5. سجّل النتيجة تحت الملاحظة.

## الإشراف
- **المشرف الأول:** جلسة Claude الرئيسية (بأمر المالك). مسؤوليتها: التدريب والإصلاح والإشراف والدمج.
- **عند غيابها:** يشرف آخرون ويلتزمون بهذه الصفحة. أي خلاف يُرفع للمالك ولا يُحسم بتعديل في الأوزان أو البوابة.
- **2026-11-06:** شام مفتوح للعمل لكل جلسة هنا؛ لا حاجة لإذن مسبق، وتبقى القواعد الهندسية أعلاه.
- مهمة جدولة المشرف (إشعارات دورية) تعطي تقريرًا عربيًا قصيرًا عن حالة التدريب.

---
**English summary:** "Sham" (old) is a from-scratch model with its own tokenizer; it writes image/audio tokens itself, so it needs NO prompt translation and reads the user's language as written. It is trained on Kaggle (CPU) and served from ModelScope. Sham v2, Nova and the candidate models are different, independent models: never mix their generators. Do not change the tokenizer, checkpoint format, merge gate or held-out yardstick, do not delete `sham-main` or the four thin workflows, Kaggle notebooks clone `ai-system/` from the production branch, never print secrets. Read `docs/SHAM_NOTES.md` and `docs/sham-pending.md`, record every change with proof. Supervisor: the main Claude session (owner's order); in its absence others supervise under these rules.
