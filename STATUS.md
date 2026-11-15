# حالة مشروع شام — 2026-11-15 16:25 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ℹ دفتر أساسي بخطأ قديم (آخر تشغيل 2026-10-11): مسار ترميز الصوت 3 (audio_tokenizer) — لا يُعدّ عطلاً اليوم؛ تنبّه مجموعات الخط الرئيسي إن توقف التقدم
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham Collector (free CPU runner)» (لم يبدأ بعد؟)
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham CPU Trainer (free CPU runner, slow and continuous)» (لم يبدأ بعد؟)
- ⚠ مجموعة الخط الرئيسي sham-multimodal-checkpoint غير موجودة في الحساب
- ⚠ sham-chat-checkpoint لم تُحدَّث منذ 7 أيام
- ⚠ sham-image-tokenizer-checkpoint لم تُحدَّث منذ 7 أيام
- ⚠ sham-audio-tokenizer-checkpoint لم تُحدَّث منذ 7 أيام

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
- running | المرحلة الأولى 7 | الدور: primary | آخر تشغيل 2026-11-15
- error | المرحلة الثالثة 5 | الدور: duplicate | آخر تشغيل 2026-11-15
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-11-15
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-11-15
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- running | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-11-15
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: duplicate | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +4 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Kaggle Inspect (read-only): 2026-11-15T16:33 in_progress
- Sham Status (supervision snapshot): 2026-11-15T16:25 in_progress
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-11-15T15:24 success ، 2026-11-15T15:17 success ، 2026-11-15T14:46 success ، 2026-11-15T10:43 success
- Sham CI (contract + self-tests, read-only): 2026-11-15T15:14 success ، 2026-11-15T14:09 success ، 2026-11-15T14:08 success ، 2026-11-15T10:46 success
- Sham v2 stage queue (the four focused notebooks, one after another): 2026-11-15T14:42 success
- Sham Merge + Repair + Eval (free CPU runner): 2026-11-15T12:58 in_progress
- Sham knowledge bank (build from the crawlers' data, push to ModelScope): 2026-11-15T12:14 success
- Sham decoder refine (image / audio tokenizer decoder only): 2026-11-15T11:27 success
- Sham Vault (checkpoint backup to ModelScope): 2026-11-15T11:25 success
- Sham v2 live capability smoke test: 2026-11-15T10:46 skipped ، 2026-11-15T08:16 skipped
- Sham ModelScope Studio (host + worker): 2026-11-15T10:41 success ، 2026-11-15T09:33 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 4242165250 | 2026-11-14 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | — | غير موجودة | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 145722206 | 2026-11-08 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35875133 | 2026-11-07 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | — | غير موجودة | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-motion-tokenizer-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الحركة الأصلي (MotionTokenizer) لمسار الفيديو — يرمّز الفرق بين الإطارات كرموز حركة، فلا يصبح الفيديو عرض شرائح |
| sham-multimodal-checkpoint | — | غير موجودة | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 581083846 | 2026-11-08 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | — | غير موجودة | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 4234779510 | 2026-11-15 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 4235480535 | 2026-11-15 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 794248504 | 2026-11-15 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 484478 | 2026-11-15 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 792108192 | 2026-11-14 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 408115 | 2026-11-14 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-ms1 | — | غير موجودة | ms_studio_trainer | مدرّب Sham على استوديو ModelScope (نموذج) |
| sham-crawl-ms1-corpus | — | غير موجودة | ms_studio_trainer | نصوص مدرّب استوديو ModelScope |
| sham-crawl-gh-collect-corpus | 687517330 | 2026-11-15 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-curated-ar-books | — | غير موجودة | ar_books_ingest | كتب عربية نظيفة (هنداوي، CC BY 4.0) مقسّمة وثائق للتدريب |
| sham-merged-checkpoint | 790911403 | 2026-11-15 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 10821 | 2026-11-15 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | — | غير موجودة | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | — | غير موجودة | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | — | غير موجودة | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | — | غير موجودة | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 781 | 2026-11-15 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 361175044 | 2026-11-15 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
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
| sham-crawl-ms2 | 792605661 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms3 | 792794402 | 2026-11-14 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms2-corpus | 723815 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms3-corpus | 3930629 | 2026-11-14 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-11-15 11:33 UTC — 🕸 الزاحف العام (GitHub): 91,279 وثيقة، 115.0 مليون حرف في 5.2 ساعة | crossref:59
```
🕸 الزاحف العام (GitHub): 91,279 وثيقة، 115.0 مليون حرف في 5.2 ساعة | crossref:59602 hackernews:30833 arxiv:360 github:265 gutenberg:96 ia_books:77 stackexchange:42 europepmc:4 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-15 09:07 UTC — 🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
```
🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
عدد الدورات: 24
مستندات جديدة مقبولة: 69
مستبعد (مكرر/شبه مكرر: 57، أسرار وكلمات مرور: 0)
خطوات تدريب حقيقية هذه الجلسة: 404 (الخطوة النهائية: 62,580)
آخر خسارة مسجّلة: 6.1820
نُشر إلى: jonsnowjonsnow/sham-research-track-checkpoint-v2
```
### 2026-11-15 05:26 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 224 (الخطوة النهائية: 62,400)
متوسط الخسارة أول 10 خطوات: 4.8310
متوسط الخسارة آخر 10 خطوات: 4.0886
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.330 → بعد 1.900 (-0.431)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (1.984) فاستُعيدت أفضل أوزان وُجدت (بعد 300 دفعة، 1.900) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 4.206
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-15 03:31 UTC — 🕸 الزاحف العام (GitHub): 90,931 وثيقة، 113.8 مليون حرف في 5.2 ساعة | crossref:59
```
🕸 الزاحف العام (GitHub): 90,931 وثيقة، 113.8 مليون حرف في 5.2 ساعة | crossref:59944 hackernews:30383 github:243 arxiv:228 ia_books:84 gutenberg:36 stackexchange:10 europepmc:3 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-14 18:42 UTC — 🕸 الزاحف العام (GitHub): 91,356 وثيقة، 114.1 مليون حرف في 5.2 ساعة | crossref:59
```
🕸 الزاحف العام (GitHub): 91,356 وثيقة، 114.1 مليون حرف في 5.2 ساعة | crossref:59850 hackernews:30702 arxiv:392 github:208 gutenberg:105 ia_books:63 europepmc:23 stackexchange:13 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-14 16:37 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 259 (الخطوة النهائية: 62,435)
متوسط الخسارة أول 10 خطوات: 4.7998
متوسط الخسارة آخر 10 خطوات: 3.3918
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.433 → بعد 1.554 (-0.879)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (1.577) فاستُعيدت أفضل أوزان وُجدت (بعد 900 دفعة، 1.554) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.529
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
