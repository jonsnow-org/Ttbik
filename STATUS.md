# حالة مشروع شام — 2026-11-22 05:41 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ℹ دفتر أساسي بخطأ قديم (آخر تشغيل 2026-10-11): مسار ترميز الصوت 3 (audio_tokenizer) — لا يُعدّ عطلاً اليوم؛ تنبّه مجموعات الخط الرئيسي إن توقف التقدم
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham Collector (free CPU runner)» (لم يبدأ بعد؟)
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham CPU Trainer (free CPU runner, slow and continuous)» (لم يبدأ بعد؟)
- ⚠ مجموعة الخط الرئيسي sham-multimodal-checkpoint غير موجودة في الحساب
- ⚠ sham-chat-checkpoint لم تُحدَّث منذ 14 أيام
- ⚠ sham-image-tokenizer-checkpoint لم تُحدَّث منذ 13 أيام
- ⚠ sham-audio-tokenizer-checkpoint لم تُحدَّث منذ 14 أيام

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: running
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: error — تقدم: {'samples_consumed': 363104, 'step': 90217, 'last_run_sources': {'clartts': 1000}, 'codebook_usage': 2012, 'recon': 0.009080708482639586}
- ⬜ مسار جمع وترميز الفيديو — دفتر: complete
- ✅ المرحلة الثانية — دمج الصورة والصوت مع النص (GPU) — دفتر: complete
- ✅ المسار A — التدريب النصي المستمر (CPU) — دفتر: complete
- ✅ المسار B — البحث الذاتي من الإنترنت (CPU) — دفتر: missing
- ✅ المرحلة الثالثة — التجميع والمحادثة (كل الوسائط + البحث + الدمج) — دفتر: complete

**الخطوة التالية المقترحة:** شام متعدد الوسائط جاهز (نص + صورة + صوت). — الخطوة التالية: تشغيل خادم شام (serve.py) على النقطة final_multimodal.pt وربطه بالموقع/البوت. أخبري Claude: «لنكمل شام».

## الدفاتر على Kaggle (بأسماء مستعارة)
- complete | المدرّب الحي 1 | الدور: primary | آخر تشغيل 2026-10-10 | GPU
- complete | المرحلة الثالثة 4 | الدور: primary | آخر تشغيل 2026-10-02
- complete | المرحلة الثالثة 3 | الدور: duplicate | آخر تشغيل 2026-10-01
- complete | المرحلة الثالثة 2 | الدور: duplicate | آخر تشغيل 2026-09-30 | GPU
- complete | مركز تحكم شام 1 | الدور: tool | آخر تشغيل 2026-09-24
- cancelAcknowledged | مسار ترميز الصورة 2 | الدور: duplicate | آخر تشغيل 2026-09-28
- error | مسار ترميز الصوت 2 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ: ---> 58             raise ConnectionError(      60         except HTTPError as e: ConnectionError: Connection error trying to communicate with service. قبل الفشل: 0.00s - to python to disable frozen m
- error | المرحلة الأولى 6 | الدور: duplicate | آخر تشغيل 2026-11-14 | GPU
- cancelAcknowledged | المرحلة الأولى 5 | الدور: duplicate | آخر تشغيل 2026-11-13
- error | المرحلة الأولى 4 | الدور: duplicate | آخر تشغيل 2026-11-13
- error | المرحلة الأولى 3 | الدور: duplicate | آخر تشغيل 2026-11-12
- running | المرحلة الأولى 7 | الدور: primary | آخر تشغيل 2026-11-22
- error | المرحلة الثالثة 5 | الدور: duplicate | آخر تشغيل 2026-11-22
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-11-22
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-11-22
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- complete | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-11-21
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: duplicate | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +4 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham CI (contract + self-tests, read-only): 2026-11-22T05:45 success ، 2026-11-22T05:09 success ، 2026-11-22T05:07 success ، 2026-11-22T05:00 success
- Sham trainer Studios status (read-only): 2026-11-22T05:41 success ، 2026-11-22T05:41 success
- Sham Status (supervision snapshot): 2026-11-22T05:40 in_progress
- Sham Kaggle Runs (read-only): 2026-11-22T05:40 in_progress
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-11-22T05:19 success ، 2026-11-22T05:13 success ، 2026-11-22T02:07 success ، 2026-11-22T02:01 success
- Sham Merge + Repair + Eval (free CPU runner): 2026-11-22T03:31 in_progress
- Sham Kaggle Inspect (read-only): 2026-11-22T01:32 success
- Sham v2 live capability smoke test: 2026-11-22T01:24 skipped

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 2423413126 | 2026-11-20 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | — | غير موجودة | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 145722206 | 2026-11-08 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35875133 | 2026-11-07 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | — | غير موجودة | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-motion-tokenizer-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الحركة الأصلي (MotionTokenizer) لمسار الفيديو — يرمّز الفرق بين الإطارات كرموز حركة، فلا يصبح الفيديو عرض شرائح |
| sham-multimodal-checkpoint | — | غير موجودة | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 581083846 | 2026-11-08 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | — | غير موجودة | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 4235934856 | 2026-11-22 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 4235480535 | 2026-11-15 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 794659902 | 2026-11-22 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | — | غير موجودة | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 792211118 | 2026-11-21 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 402432 | 2026-11-21 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-ms1 | — | غير موجودة | ms_studio_trainer | مدرّب Sham على استوديو ModelScope (نموذج) |
| sham-crawl-ms1-corpus | — | غير موجودة | ms_studio_trainer | نصوص مدرّب استوديو ModelScope |
| sham-crawl-gh-collect-corpus | 733715215 | 2026-11-22 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-curated-ar-books | — | غير موجودة | ar_books_ingest | كتب عربية نظيفة (هنداوي، CC BY 4.0) مقسّمة وثائق للتدريب |
| sham-merged-checkpoint | 790973591 | 2026-11-22 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 12127 | 2026-11-22 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | — | غير موجودة | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | — | غير موجودة | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | — | غير موجودة | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | — | غير موجودة | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 763 | 2026-11-22 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 529782227 | 2026-11-21 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
| sham-crawl-modal | — | غير موجودة | modal_gpu | نموذج جلسات GPU على Modal (مرشّح لبوابة الدمج) |
| sham-grown-checkpoint | — | غير موجودة | model_grow | أفضل نقطة حفظ بالقياس بعد التكبير (طبقات أكثر وسياق أطول، الدالة محفوظة) — يفضّلها الدمج والمدرّب الحي عند التعادل |
| sham-image-tokenizer-v2-checkpoint | — | غير موجودة | lightning_probe | مُرمِّز الصورة v2 (128 بكسل، 64 رمزاً، يُدرَّب على CPU في استوديو Lightning) |
| sham-image-tokenizer-hd-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الصورة عالي الدقة (384 بكسل، 576 رمزاً)؛ سلالة جديدة لا تمس المُرمِّز المخدوم، يدرّبها استوديو ModelScope (وظيفة codec) |
| sham-audio-tokenizer-v2-checkpoint | — | غير موجودة | lightning_probe | مُرمِّز الصوت v2 (كل مقاطع كل مقطع، يُدرَّب على CPU في استوديو Lightning) |
| sham-chat-arabic-sft-checkpoint | — | غير موجودة | arabic_sft | نقطة دفتر SFT العربي المنفصل (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-repair-remerge-checkpoint | 3704052342 | 2026-11-08 | repair_remerge | ناتج أداة الاسترجاع والإصلاح وإعادة الدمج (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-runtime-creds | — | غير موجودة | any | مجموعة خاصة بملف اعتماد كاكل للنسخ المدفوعة بالواجهة (أسرار — لا تُرفق إلا بدفاتر خاصة؛ لا أوزان فيها) |
| sham-v2-checkpoint | — | غير موجودة | sham_v2_train | نقطة حفظ سلالة شام v2 (جسم المانح المنقول + صفوف الوسائط المدرَّبة)؛ سلالة منفصلة بمُرمِّز المانح فلا تُدمج مع السلالة القديمة |
| sham-media-refined | — | غير موجودة | decoder_refine | مفكّ الصورة والصوت المصقول وحده (الترميز والقاموس كما هما بالضبط) — يُعتمد في الاستوديو فقط إذا طابق ترميز النموذج المدموج |
| sham-v2-candidate-checkpoint | — | غير موجودة | sham_v2_candidate_train | نقطة حفظ السلالة المرشحة لشام v2 (جسم SmolLM3-3B المنقول)؛ لا تحلّ محل المخدومة إلا عبر sham_v2_switch.py بقياس |
| sham-crawl-ms3 | 791962411 | 2026-11-22 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-nb1 | 791940993 | 2026-11-22 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms3-corpus | 12824891 | 2026-11-22 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-nb1-corpus | 6863812 | 2026-11-22 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-11-22 05:28 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 271 (الخطوة النهائية: 89,050)
متوسط الخسارة أول 10 خطوات: 4.1306
متوسط الخسارة آخر 10 خطوات: 3.6236
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 3.665 → بعد 3.396 (-0.269)
🛡 الحارس: نهاية الجلسة هي الأفضل أو ضمن الهامش (أفضل 3.398) — لا استعادة.
خسارة التدريب في آخر 50 خطوة: 3.473
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-22 04:50 UTC — 🕸 الزاحف العام (GitHub): 78,378 وثيقة، 100.1 مليون حرف في 5.2 ساعة | crossref:50
```
🕸 الزاحف العام (GitHub): 78,378 وثيقة، 100.1 مليون حرف في 5.2 ساعة | crossref:50500 hackernews:26892 github:497 ia_books:304 arxiv:148 verified_tests:20 stackexchange:17 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-21 23:37 UTC — 🕸 الزاحف العام (GitHub): 79,615 وثيقة، 100.6 مليون حرف في 5.2 ساعة | crossref:51
```
🕸 الزاحف العام (GitHub): 79,615 وثيقة، 100.6 مليون حرف في 5.2 ساعة | crossref:51128 hackernews:26967 arxiv:924 ia_books:317 github:184 europepmc:61 verified_tests:33 stackexchange:1 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-21 17:29 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 272 (الخطوة النهائية: 88,779)
متوسط الخسارة أول 10 خطوات: 3.8774
متوسط الخسارة آخر 10 خطوات: 3.5266
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 1.931 → بعد 1.615 (-0.316)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (1.629) فاستُعيدت أفضل أوزان وُجدت (بعد 1000 دفعة، 1.615) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.566
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-21 12:11 UTC — 🕸 الزاحف العام (GitHub): 74,605 وثيقة، 95.8 مليون حرف في 5.2 ساعة | crossref:472
```
🕸 الزاحف العام (GitHub): 74,605 وثيقة، 95.8 مليون حرف في 5.2 ساعة | crossref:47229 hackernews:25645 arxiv:778 ia_books:522 github:395 stackexchange:28 europepmc:8 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-21 12:00 UTC — 🤖 مدرّب CPU على GitHub: 999 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jo
```
🤖 مدرّب CPU على GitHub: 999 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.996
```
