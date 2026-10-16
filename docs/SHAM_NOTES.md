# دفتر ملاحظات مشروع شام

دفتر ملاحظات مخصّص لمهندس شام.

## طريقة الاستخدام
- كل ملاحظة لها **رقم** و**تاريخ** وسطر حالة: `الحالة: بانتظار المراجعة`.
- بعد ما يقرأ المراجع الملاحظة ويصلح النقاط، يكتب تحتها:
  `تمت المراجعة بتاريخ ____ وتم إصلاح النقاط المذكورة`
- لا تُحذف الملاحظات القديمة، تُضاف الجديدة في الأسفل برقم تالٍ.

---

## الفهرس

1. ملاحظة رقم 1 — `docs/FOR_SHAM_ENGINEER_NOTE_arabic_sft_merge.md`
2. ملاحظة رقم 2 — `docs/FOR_SHAM_ENGINEER_NOTE_studio_checkpoint_mistake.md`
3. ملاحظة رقم 3 — `docs/FOR_SHAM_ENGINEER_NOTE_platforms_status_2026-10-15.md`
4. ملاحظة رقم 4 — `docs/FOR_SHAM_ENGINEER_REVIEW_arabic_sft.md`
5. ملاحظة رقم 5 — `docs/FOR_SHAM_ENGINEER_REVIEW_checkpoints_and_restarter.md`
6. ملاحظة رقم 6 — بوابة الدمج ترفض النقاط (2026-10-16)

---

## ملاحظة رقم 1 — 2026-10-15

الحالة: بانتظار المراجعة

المصدر الأصلي (منسوخ كاملاً، الملف الأصلي بدون تعديل): `docs/FOR_SHAM_ENGINEER_NOTE_arabic_sft_merge.md`

### ملاحظة للمهندس: دفتر تدريب عربي إضافي + اقتراح دمج الأوزان

#### ما الذي تم
- شغّلنا دفتراً جديداً منفصلاً على كاكل: `jonsnowjonsnow/sham-arabic-sft` (خاص، يعمل على CPU أو GPU تلقائياً).
- الهدف: تحسين قدرة شام على الرد العربي المترابط ببيانات محادثة وتعليمات عربية كبيرة.
- الدفتر نسخة من خلايا دفتر المحادثة عندك بنفس الإعدادات والبنية والمرمّز وطريقة الحفظ والاستئناف. لم يُعدَّل أي شيء في دفاترك الثلاثة أو إعداداتك أو مجموعات نقاط الحفظ الأصلية.
- يبدأ من نسخة من `final_chat.pt` ويحفظ في مجموعة منفصلة: `sham-chat-arabic-sft-checkpoint`، ويستأنف من نقطته في كل تشغيل.
- يتحقق قبل التدريب من تطابق النقطة (111 مفتاحاً، 12 طبقة، 768، سياق 1024) ويتوقف إن وُجد اختلاف.
- 2% من البيانات محجوزة للقياس فقط، وتُسجَّل خسارتها مع أمثلة ردود عند كل حفظ.
- القياس قبل التدريب: خسارة مقياسك 5.06، خسارة البيانات المحجوزة 5.99.
- نقطة البداية: نفس آخر نسخة من `sham-chat-checkpoint` التي يستخدمها الاستديو (رُبطت وقت الرفع). أرقام القياس أعلاه من اختبار محلي على نسخة أقدم.
- خطوة توصيل للاستديو أضيفت في `sham-modelscope.yml` وهي مطفأة افتراضياً (`SHAM_STUDIO_ARABIC_SFT`). الاستديو ما زال على `final_chat.pt`.

#### الاقتراح: دمج الأوزان في نقطة نهائية واحدة
لا نريد نقطتين نهائيتين (كأنهما نموذجان منفصلان). نقترح اعتماد دمج الأوزان:
- السكربت `sham_sft_merge.py` يأخذ متوسطاً موزوناً بين `final_chat.pt` ونقطة الدفتر الجديد بنسبة قابلة للضبط، ويقيس كل نسبة على بيانات محجوزة لم يرها أي نموذج، ويرفض الدمج إن لم تتطابق النقطتان.
- النتيجة نقطة نهائية واحدة تحافظ على ما تعلّمه النموذج عندك وتضيف التحسن العربي.
- لم يُشغَّل الدمج ولم يُربط بأي workflow. القرار لك في اعتماده واختيار النسبة.

#### تحديث: الاعتماد على آلية الدمج الموجودة عندك
- اتضح أن `sham-merge-eval.yml` (`sham_ci_merge.py`) يكتشف تلقائياً كل مجموعة تبدأ بـ `sham` ويدمجها في `final_merged.pt` بعد بوابة القياس.
- لذلك ستدخل `sham-chat-arabic-sft-checkpoint` في دمجك الحالي تلقائياً إن حسّنت النتائج، ولا حاجة لسكربت `sham_sft_merge.py` (يبقى للمراجعة فقط، غير مستخدم).
- خطوة `SHAM_STUDIO_ARABIC_SFT` في `sham-modelscope.yml` تبقى مطفأة ولا يُقترح تفعيلها.

#### تأكيد ما يشغّله الاستديو (2026-10-15)
- `sham-modelscope.yml` يرفع للاستديو `final_merged.pt` دائماً، ومعه `final_chat.pt` لأن متغير المستودع `SHAM_STUDIO_CHAT_CKPT=1` مفعّل منذ 2026-10-14 بقرار المالك.
- `app.py` يفضّل `final_chat.pt` بالاسم، فالاستديو يرد حالياً من نقطة مرحلة المحادثة (قبل بوابة الدمج)، لا من `final_merged.pt`.
- بإلغاء هذا المتغير يعود الاستديو إلى `final_merged.pt`، وعندها يصل أثر الدفتر العربي عبر آلية دمجك فقط. القرار لك وللمالك.

<!-- بعد المراجعة اكتب هنا: تمت المراجعة بتاريخ ____ وتم إصلاح النقاط المذكورة -->

---

## ملاحظة رقم 2 — 2026-10-15

الحالة: بانتظار المراجعة

المصدر الأصلي (منسوخ كاملاً، الملف الأصلي بدون تعديل): `docs/FOR_SHAM_ENGINEER_NOTE_studio_checkpoint_mistake.md`

### ملاحظة للمهندس: خطأ في نقطة الاستديو وتم الرجوع للتصميم الأصلي (2026-10-15)

#### ما الذي أخطأنا فيه
- في 2026-10-14 أضفنا خياراً (متغير المستودع `SHAM_STUDIO_CHAT_CKPT=1`) جعل `sham-modelscope.yml` يرفع `final_chat.pt` (ومعه `final_chat_self.pt` إن وُجد) إلى الاستديو، وجعل `app.py` يفضّله بالاسم.
- النتيجة: الاستديو والبوت صارا يردّان من نقطة مرحلة المحادثة قبل بوابة الدمج، بدل `final_merged.pt` كما في تصميمك.

#### ما الذي فعلناه للرجوع للصحيح
- ضبطنا `SHAM_STUDIO_CHAT_CKPT=0`.
- commit `856c3136` في `ai-system/modelscope-sham/app.py`: يختار `final_merged.pt` أولاً، والترتيب القديم باقٍ ولا يعمل إلا إذا وُضع `SHAM_STUDIO_CHAT_CKPT=1` في إعدادات الاستديو.
- أُعيد نشر الاستديو؛ تحقّقنا أنه يحمّل `final_merged.pt` (الخطوة 61,555) منذ 16:05 بتوقيت إسطنبول.

#### نسخة بلا وظيفة في ملفات الاستديو
- ملف `final_chat.pt` (وربما `final_chat_self.pt`) الذي رفعناه ما زال موجوداً في ملفات الاستديو/مستودع النموذج على ModelScope، ولا يُستخدم الآن.
- لم نحذفه ولم نغيّر اسمه حتى لا يضيع عليك. لك أن تحذفه أو تبقيه حسب ما تفضّل.

#### طلب من المالك
- يرجى مراجعة كل عملنا على `sham-main` وما يتعلق بالاستديو وإصلاح أي خطأ تجده. أبرز ما أضفناه:
  - ذاكرة المحادثة وإصلاح تكرارها (`sham_memory.py`، `app.py` `_compact_history`، commit `b4a7fe6e`).
  - خلايا بيانات الاعتماد V3/V4 والتشغيل على CPU في دفاتر كاكل والمراقب `sham_restarter`.
  - الدفتر العربي `sham-arabic-sft` ومجموعته `sham-chat-arabic-sft-checkpoint` (تدخل في دمجك تلقائياً)، وسكربت `sham_sft_merge.py` غير المستخدم، وخطوة `SHAM_STUDIO_ARABIC_SFT` المطفأة في `sham-modelscope.yml`.
  - ملاحظات `docs/FOR_SHAM_ENGINEER_*`.

<!-- بعد المراجعة اكتب هنا: تمت المراجعة بتاريخ ____ وتم إصلاح النقاط المذكورة -->

---

## ملاحظة رقم 3 — 2026-10-15

الحالة: بانتظار المراجعة

المصدر الأصلي (منسوخ كاملاً، الملف الأصلي بدون تعديل): `docs/FOR_SHAM_ENGINEER_NOTE_platforms_status_2026-10-15.md`

### ملاحظة للمهندس: جولة على وظائف التدريب خارج دفاتر كاكل (2026-10-15، قراءة فقط)

#### الوضع العام
- كل وظائف التدريب على GitHub شغّالة وتنجح، لكن `final_merged.pt` واقف عند الخطوة 61,555. آخر دمج (13:22 إسطنبول) لم يقبل أي مصدر جديد. الأرقام قبل وبعد: text 4.291، chat 3.838، media 4.775.

#### كل وظيفة
- `sham-cpu-trainer` (كل 6 ساعات): سليم. تشغيل 07:24 درّب 1,101 خطوة ونشر في `sham-crawl-gh`، وخسارة النص على المحجوز 4.62.
- `sham-lightning` (كل 4 ساعات): سليم لكن على CPU لأن L4 رُفض (403). درّب 651 خطوة وحفظ 61,786 في `sham-crawl-lightning`.
- `sham-merge-eval` (4 مرات يومياً): ينجح لكن لا يقبل جديداً.
- `sham-modelscope`: سليم. رسالة 404 من كاكل ثم نجح التنزيل والرفع.
- `sham-grow`: يدوي، آخر تشغيل 11/10، نقطته 61,555.
- `sham-modal`: يدوي، متوقف منذ 11/10.
- Sham CI: فشل 14:37 على طلب دمج (فحص كود، السبب غير واضح من السجل).

#### مصادر رُفضت أو لم تُقبل في الدمج
- مُجرَّبة سابقاً ولم تدخل: `sham-checkpoint` 61,841، multimodal 63,371، crawl-gh 62,656، crawl-lightning 62,073، crawl-checkpoint 66,129.
- `research-track-v2` رُفض لعدم وجود ملف تقطيع النص.
- لم تُحمَّل (403): `sham-chat-checkpoint-incoming`، `sham-crawl-legacy`.
- `sham-chat-arabic-sft-checkpoint` لم يظهر بعد، على الأغلب لأنه لا نقطة محفوظة فيه حتى الآن.

#### مشاكل تحتاج مراجعتك
1. `final_merged` لا يتقدم لأن لا مصدر يعبر البوابة.
2. خطوة قياس التفكير في الدمج: خسارة الحلول نزلت 4.65 إلى 0.40، لكن خسارة النص ارتفعت 4.34 إلى 6.64، ونُشرت نسخة في `sham-merged-checkpoint`. يرجى التأكد أنها لا تخرّب النص.
3. أغلب نقاط المصادر تحتاج إصلاحاً قبل الدمج: 18 مصفوفة بقيم منفجرة أو 81 مصفوفة ناقصة، ونقطتان بملف تقطيع مختلف. قد يكون هذا سبب عدم عبور البوابة.
4. كاكل: 403 على مجموعتين، و429 كثرة طلبات، والتنزيل الكامل يفشل كثيراً فيُنزَّل ملفاً ملفاً.
5. لا GPU: Lightning على CPU (L4 مرفوض)، وModal متوقف.
6. تقارير تيليجرام من وظائف GitHub لا تصل: «no token/chat_id».

<!-- بعد المراجعة اكتب هنا: تمت المراجعة بتاريخ ____ وتم إصلاح النقاط المذكورة -->

---

## ملاحظة رقم 4 — 2026-10-15

الحالة: بانتظار المراجعة

المصدر الأصلي (منسوخ كاملاً، الملف الأصلي بدون تعديل): `docs/FOR_SHAM_ENGINEER_REVIEW_arabic_sft.md`

### For the Sham engineer: separate Arabic SFT notebook (review)

Added 2026-10-15 with the owner's approval. Additive only. Nothing of yours was changed.

#### What it is
- New private Kaggle kernel `jonsnowjonsnow/sham-arabic-sft`. Source: `ai-system/colab/sham_small/kaggle_notebooks/arabic_sft/`. Push workflow: `.github/workflows/sham-arabic-sft-push.yml`.
- Starts from a **copy** of `sham-chat-checkpoint/final_chat.pt` (read-only). Every later run resumes from its own output.
- Publishes to a **new** private dataset `sham-chat-arabic-sft-checkpoint`: `final_chat.pt`, the tokenizers, `sft_progress.json` and `sft_eval_history.json`.
- It mirrors your chat-stage notebook:
  - V3/V4 cells (taken verbatim from `kaggle_auto_resume.py`).
  - Clone cell.
  - `load_checkpoint`, `ShamTextTokenizer`, `build_chat_example` / `build_multiturn_example`, `batch_examples`.
  - `train(TrainConfig)` with the same lr 5e-5, wd 0.1, grad_accum 2 and session hours.
  - `sham_eval.evaluate`, `save_checkpoint`, `publish_dataset`.
- Model config and hyperparameters are untouched.
- Before training it checks that the keys, shapes and config are identical to the source checkpoint. On a mismatch it stops and reports instead of forcing anything.

#### Data (streamed from Hugging Face, a share per source per session, progress saved)
| Source | License | Kind |
|---|---|---|
| arbml/CIDAR | apache-2.0 | native |
| CohereLabs/aya_dataset (Arabic) | apache-2.0 | human-written |
| FreedomIntelligence/alpaca-gpt4-arabic | apache-2.0 | GPT-4 / translated |
| FreedomIntelligence/evol-instruct-arabic | none stated | translated |
| 2A2I/Arabic-OpenHermes-2.5 | apache-2.0 | translated |
| HeshamHaroon/saudi-dialect-conversations | apache-2.0 | GPT-4o Najdi, multi-turn |
| MBZUAI/Bactrian-X (ar) | **CC-BY-NC-4.0** | MT + GPT answers |
| CohereLabs/aya_collection_language_split (standard_arabic) | apache-2.0 | templated / translated |
| hammh0a/Hala-4.6M-SFT | **CC-BY-NC-4.0** | MT, 4.06M rows |

Limit the sources with `SHAM_SFT_SOURCES=key1,key2`.

#### Understanding vs memorization
- 2% of questions, chosen by a stable sha1 bucket, are never trained on.
- 64 of them are frozen in `sft_progress.json` as a fixed yardstick.
- Every save logs the held-out loss and sample generations, plus your `sham_eval` before/after, into `sft_eval_history.json`.

#### Studio
- `sham-modelscope.yml` gained one step, gated by the repo variable `SHAM_STUDIO_ARABIC_SFT == '1'` (unset = OFF).
- When ON, it places this dataset's `final_chat.pt` instead of the chat-stage one before the sync.
- Note: `app.py` prefers `final_chat_self.pt` if present.

#### Not done (proposal)
- Not added to `sham-restarter`.
- Proposal: track `sham-arabic-sft` as a 4th kernel with the same breaker and daily cap, after your approval.
- Phase 2, not trained: a small code mix (5–10%) from Magicoder-OSS-Instruct-75K (MIT), CodeFeedback-Filtered-Instruction (apache-2.0), nvidia/OpenCodeInstruct (CC-BY-4.0), and evol-instruct-arabic's code questions.

#### Merge proposal (toward ONE final checkpoint)
- `ai-system/colab/sham_small/sham_sft_merge.py` is standalone. No workflow runs it.
- What it does:
  - Refuses to merge unless the config, keys and shapes match.
  - Averages the chat and SFT `state_dict`s at each ratio in `--ratios`.
  - Scores every ratio on `sham_eval`'s fixed pairs plus the SFT frozen held-out questions.
  - Saves the best ratio only if `--out` is given, and never publishes.
- The SFT notebook keeps the same config, keys, shapes and tokenizer as `final_chat.pt`, which it checks before training, so averaging stays possible.

<!-- بعد المراجعة اكتب هنا: تمت المراجعة بتاريخ ____ وتم إصلاح النقاط المذكورة -->

---

## ملاحظة رقم 5 — 2026-10-15

الحالة: بانتظار المراجعة

المصدر الأصلي (منسوخ كاملاً، الملف الأصلي بدون تعديل): `docs/FOR_SHAM_ENGINEER_REVIEW_checkpoints_and_restarter.md`

### مراجعة للمهندس: نقاط الحفظ والمراقب (sham-restarter)

> كُتبت بطلب المالك في 2026-10-15 (توقيت إسطنبول). **وثيقة فقط، ولا يتغير معها أي كود.** القرار للمهندس، ولا توصية مفروضة.
> المالك يخاف أن يضر أي تعديل بضبط المهندس للنموذج، لذلك لم يُمسّ ترتيب نقاط الحفظ ولا إعدادات النموذج.

#### 1) جرد نقاط الحفظ

المصادر: `ai-system/scripts/sham_registry.py` (TRACKS)، و`ai-system/colab/sham_small/sham_ci_merge.py`، و`.github/workflows/sham-modelscope.yml`، و`ai-system/modelscope-sham/app.py` و`sync_to_modelscope.py`.

| مجموعة بيانات كاكل | الملف | ما الذي ينتجها | ما الذي يستهلكها |
|---|---|---|---|
| `sham-checkpoint` | `final.pt` و`sham_small_tokenizer.json` | المرحلة الأولى، النص الأساسي (GPU) | المراحل اللاحقة، والمقطّع يستخدمه الاستديو |
| `sham-cpu-track-checkpoint-v2` | `final.pt` و`sham_cpu_tokenizer.json` | المسار A، التدريب النصي المستمر (CPU) | الدفتر نفسه، فهو يستأنف من نقطته |
| `sham-research-track-checkpoint-v2` | `final.pt` و`sham_research_tokenizer.json` | المسار B، البحث الذاتي (CPU) | الدفتر نفسه، فهو يستأنف من نقطته |
| `sham-image-tokenizer-checkpoint` | `image_tokenizer.pt` | مسار ترميز الصورة (VQ-VAE) | الدمج والاستديو (للوسائط، ولا يُختار كنموذج لغة) |
| `sham-audio-tokenizer-checkpoint` | `audio_tokenizer.pt` | مسار ترميز الصوت | الدمج والاستديو |
| `sham-multimodal-checkpoint` | `final_multimodal.pt` | المرحلة الثانية، الصورة والصوت مع النص | `sham_ci_merge.py` (MAIN_LINE) |
| `sham-crawl-checkpoint` | `final.pt` | المدرّب الحي | `sham_ci_merge.py` (MAIN_LINE) |
| `sham-chat-checkpoint` | `final_chat.pt` | المرحلة الثالثة، التجميع والمحادثة | `sham_ci_merge.py` (MAIN_LINE)، والاستديو مباشرة إذا كان `SHAM_STUDIO_CHAT_CKPT=1` |
| `sham-merged-checkpoint` | `final_merged.pt` و`merge_progress.json` | `sham_ci_merge.py` على GitHub Actions: يختار القاعدة الأفضل **بالقياس** (probe، مع هامش 5%)، ثم يدمج ويمر ببوابة الدمج | `sham-modelscope.yml`، ثم الاستديو |
| (اختياري) | `final_chat_self.pt` | التعلم الذاتي المحروس | الاستديو، وهو الأول في الأولوية إن وُجد |

**ماذا يستخدم الاستديو أو البوت الآن:**
- `app.py` يختار بالاسم بهذا الترتيب `CKPT_ORDER = ("final_chat_self.pt", "final_chat.pt", "final_merged.pt")`، إلا إذا كان `SHAM_CKPT_BY_NAME=0`، فيرجع إلى السطر القديم الذي يقدّم `final_merged.pt`.
- خطوة "Chat checkpoints for the Studio" في `sham-modelscope.yml` لا تعمل إلا مع `vars.SHAM_STUDIO_CHAT_CKPT == '1'`، وهي **مفعّلة الآن**. لهذا يخدم الاستديو الآن **`final_chat.pt`**.
- تعليق الـ workflow نفسه ينبّه إلى أن `final_chat.pt` هي مرحلة المحادثة **قبل بوابة الدمج** و**بدون خط الوسائط**.

**السلوك الملاحظ:**
- `final_chat` تكرر الجملة نفسها مع أسئلة مختلفة، مثل: «سأكون في هذا اليوم يوم الصوم».
- خسارة المحادثة نحو **5.27**، وهي بعيدة عن الرد الطبيعي. وكانت النسخة المدمجة `final_merged` أفضل في التجربة.
- سطر التاريخ يتكرر في الردود. مصدره المرجّح `SHAM_STUDIO_DATE`، لأن `sham_studio_chat.build_user_text` يضيف `date_context_line` قبل كل سؤال، وربما ساهمت فيه أيضاً أمثلة التدريب التي فيها سطر التاريخ. والمفتاح `SHAM_STUDIO_DATE=0` يلغي السطر.
- المالك اختار أن **يبقى** `final_chat` الآن (لم يرجع إلى المدمجة).

#### 2) خيارات للمهندس (بدون توصية مفروضة)

**أ) إبقاء النقاط المتعددة كما هي**
- المزايا: لا يتغير شيء، وكل مرحلة تستأنف من نقطتها، والدمج يختار بالقياس أصلاً.
- العيوب: يربك المالك وجود نسختين نهائيتين (`final_merged` و`final_chat`). والاستديو يقدّم `final_chat` بالاسم حتى لو كانت أضعف في القياس.

**ب) مؤشر واحد واضح «أفضل نسخة حالية» يُحدَّث تلقائياً عند تحسّن التقييم (بدون حذف)**
- مثلاً ملف `current_best.json` فيه اسم الملف وsha والخسارة، ويكتبه الدمج أو التقييم، ويقرأه `app.py` قبل `CKPT_ORDER`.
- المزايا: النقطة المخدومة واحدة ومقاسة، والنقاط القديمة تبقى كما هي.
- العيوب: يحتاج معيار تقييم موحداً بين نقطة محادثة نصية ونقطة مدمجة متعددة الوسائط، وفيه خطر أن يقدّم مؤشر خاطئ نسخة أسوأ تلقائياً.

**ج) إرجاع الاستديو إلى `final_merged`**
- يكفي `SHAM_STUDIO_CHAT_CKPT=0` ثم إعادة رفع ملفات الاستديو، أو `SHAM_CKPT_BY_NAME=0`.
- المزايا: نسخة مرّت ببوابة الدمج، وفيها الصورة والصوت، وردودها أفضل في التجربة.
- العيوب: تخسر أسلوب المحادثة المدرَّب في `final_chat`.

#### 3) سجل تغييرات اليوم 2026-10-15 (إسطنبول)

كلها بالإضافة، ولم يُحذف شيء.
- وُجد أن `sham-restarter` يعمل **تجريبياً فقط** (`RESTARTER_LIVE=0`) لأن متغير المستودع كان غير موجود.
- `c552f0bf`: صار المراقب يرفع الدفتر الواقف من أول مرة يراه فيها (grace = 0)، وبقي الحد اليومي (8) والقاطع (breaker).
- اكتُشف أن نسخ كاكل المرفوعة بالـ API ترد بـ **400** على `UserSecretsClient().get_secret(...)`، مع أن الأسرار مربوطة بالدفتر.
- `cab13726` ثم `084a1b82`: أصبحت الخلية الأولى تكمل بطريقة بديلة إذا فشل قراءة السر (المستودع عام، فالسحب يتم بلا توكن). وأُنشئت مجموعة بيانات **خاصة** هي `jonsnowjonsnow/sham-runtime-creds` وفيها `kaggle.json`، ويربطها `kaggle_auto_resume` بالدفاتر عند الرفع، ويقرؤها `sham_inputs` كبديل.
- `9a79c910`: إعادة ضبط القاطع مرة واحدة بعد الإصلاح.
- في فرع الموقع: `2d746bd7` (`sham-runtime-creds.yml`) و`509a357c` (بديل `sham_inputs`).
- النتيجة: الدفتر الشامل تجاوز الخلية الأولى وفي سجله «sham-runtime-creds: موجودة»، وهو يتدرب على GPU.
- أصبح `SHAM_RESTART_LIVE=1` الآن.
- الجدولة مكتوبة كل 15 دقيقة، لكن GitHub يشغّلها فعلياً كل **3 إلى 5 ساعات**.

**ملاحظة أمنية:** مجموعة `sham-runtime-creds` خاصة، لكنها تحمل مفتاح كاكل كاملاً داخل بيانات مربوطة بالدفاتر. وقد يفضّل المهندس طريقة أخرى، مثل مفتاح محدود الصلاحية أو تدويره دورياً أو آلية مختلفة.

#### 4) أسئلة مفتوحة للمهندس

1. هل يبقى `final_chat` هو المخدوم، أو نرجع إلى `final_merged`، أو نعتمد مؤشر «أفضل نسخة» (الخيار ب)؟
2. ما معيار التقييم الموحد الذي يصلح للمقارنة بين نقاط المحادثة والنقاط المدمجة؟
3. هل سبب التكرار في `final_chat` نقص التدريب (خسارة 5.27)، أو إعدادات التوليد مثل عقوبة التكرار والحرارة، أو أمثلة التدريب نفسها؟
4. هل نطفئ `SHAM_STUDIO_DATE`، أو ننظّف بيانات التدريب من سطر التاريخ المتكرر؟
5. هل يقبل المهندس آلية `sham-runtime-creds`، أو يفضّل بديلاً؟
6. هل الإعدادات الحالية للمراقب مناسبة: الحد اليومي 8، والقاطع بعد انهيارين سريعين، والتشغيل على GPU إن سمحت الحصة وإلا CPU؟
7. هل يلزم دمج النسخ القديمة `-v2` وما قبلها، أو تبقى كما هي؟

<!-- بعد المراجعة اكتب هنا: تمت المراجعة بتاريخ ____ وتم إصلاح النقاط المذكورة -->

---

## ملاحظة رقم 6 — 2026-10-16: بوابة الدمج ترفض النقاط

الحالة: بانتظار المراجعة

**المرجع (نقطة الدمج الحالية، الخطوة 61,555):** محادثة 3.607، وسائط 3.108، نص 4.365.

| النقطة | الخطوة | محادثة | وسائط | نص | النتيجة |
|---|---|---|---|---|---|
| sham-multimodal-checkpoint | 63,882 | 3.631 | 3.064 | 4.357 | مرفوضة |
| sham-chat-arabic-sft-checkpoint | 63,620 | 3.613 | 3.111 | 4.323 | مرفوضة |
| sham-chat-checkpoint | 63,244 | 3.613 | 3.111 | 4.323 | مرفوضة |
| sham-cpu-track-checkpoint-v2 | 61,853 | — | — | — | مقبولة بنسبة 0.05 |

**السبب:**
- البوابة تشترط عدم التراجع في أي مهارة.
- كل دفتر يحسّن مهارته لكنه يتراجع قليلاً في مهارة أخرى.
- المصادر ابتعدت كثيراً عن قاعدة الدمج (61,555)، فيصعب دمجها.

**اقتراح يقرّره المهندس (لم يُطبَّق):** السماح بتراجع بسيط في مهارة واحدة عندما تتحسّن مهارة أخرى بشكل ملحوظ.

**ملاحظة إضافية:** قسم التدريب الصغير (`sham-checkpoint`) لم يحفظ أي نسخة منذ 10 أكتوبر.

<!-- بعد المراجعة اكتب هنا: تمت المراجعة بتاريخ ____ وتم إصلاح النقاط المذكورة -->
