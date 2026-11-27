# حالة مشروع شام — 2026-11-27 01:46 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ℹ دفتر أساسي بخطأ قديم (آخر تشغيل 2026-10-11): مسار ترميز الصوت 3 (audio_tokenizer) — لا يُعدّ عطلاً اليوم؛ تنبّه مجموعات الخط الرئيسي إن توقف التقدم
- ⚠ sham-multimodal-checkpoint لم تُحدَّث منذ 21 أيام
- ⚠ sham-chat-checkpoint لم تُحدَّث منذ 18 أيام
- ⚠ sham-image-tokenizer-checkpoint لم تُحدَّث منذ 18 أيام
- ⚠ sham-audio-tokenizer-checkpoint لم تُحدَّث منذ 19 أيام

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
- cancelAcknowledged | المرحلة الأولى 6 | الدور: duplicate | آخر تشغيل 2026-11-23
- cancelAcknowledged | المرحلة الأولى 5 | الدور: duplicate | آخر تشغيل 2026-11-23
- error | المرحلة الأولى 4 | الدور: duplicate | آخر تشغيل 2026-11-23
- error | المرحلة الأولى 3 | الدور: duplicate | آخر تشغيل 2026-11-22
- running | المرحلة الأولى 7 | الدور: primary | آخر تشغيل 2026-11-27
- error | المرحلة الثالثة 5 | الدور: duplicate | آخر تشغيل 2026-11-27
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-11-26
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-11-26
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- running | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-11-26
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: duplicate | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +4 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-11-27T01:45 in_progress
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-11-27T01:12 success ، 2026-11-27T01:06 success ، 2026-11-27T00:57 success ، 2026-11-27T00:52 success
- Sham Merge + Repair + Eval (free CPU runner): 2026-11-27T01:09 in_progress
- Sham decoder refine (image / audio tokenizer decoder only): 2026-11-26T23:58 in_progress
- Sham Vault (checkpoint backup to ModelScope): 2026-11-26T23:58 success
- Sham v2 mirror to the international site (model + T-LDM head, cn -> ai): 2026-11-26T22:58 success
- Sham CI (contract + self-tests, read-only): 2026-11-26T22:40 success ، 2026-11-26T21:54 success ، 2026-11-26T21:29 success ، 2026-11-26T21:03 success
- Sham Token Shards (free CPU runner): 2026-11-26T21:58 success
- Sham v2 stage queue (the four focused notebooks, one after another): 2026-11-26T21:53 success
- Sham distillation network (teachers -> verified records -> the Kaggle pool every trainer reads): 2026-11-26T21:39 success
- Sham Collector (free CPU runner): 2026-11-26T21:26 in_progress
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-11-26T21:23 in_progress
- Sham Pro live repeat probe (read-only): 2026-11-26T20:22 success
- Sham v2 host image: build check (CPU container for a second free host; no push, no secrets): 2026-11-26T20:22 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 4238119679 | 2026-11-26 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | — | غير موجودة | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 145722206 | 2026-11-08 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35875133 | 2026-11-07 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | — | غير موجودة | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-motion-tokenizer-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الحركة الأصلي (MotionTokenizer) لمسار الفيديو — يرمّز الفرق بين الإطارات كرموز حركة، فلا يصبح الفيديو عرض شرائح |
| sham-multimodal-checkpoint | 582049080 | 2026-11-05 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 581083846 | 2026-11-08 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | — | غير موجودة | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 4236277474 | 2026-11-26 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 4235480535 | 2026-11-15 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 794512953 | 2026-11-25 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 537889 | 2026-11-25 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 792109172 | 2026-11-27 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 332332 | 2026-11-26 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-ms1 | — | غير موجودة | ms_studio_trainer | مدرّب Sham على استوديو ModelScope (نموذج) |
| sham-crawl-ms1-corpus | — | غير موجودة | ms_studio_trainer | نصوص مدرّب استوديو ModelScope |
| sham-crawl-gh-collect-corpus | 736217464 | 2026-11-27 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-curated-ar-books | 176853496 | 2026-11-12 | ar_books_ingest | كتب عربية نظيفة (هنداوي، CC BY 4.0) مقسّمة وثائق للتدريب |
| sham-merged-checkpoint | 790681717 | 2026-11-26 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 11538 | 2026-11-26 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | — | غير موجودة | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 765 | 2026-11-27 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 529817247 | 2026-11-26 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
| sham-crawl-modal | — | غير موجودة | modal_gpu | نموذج جلسات GPU على Modal (مرشّح لبوابة الدمج) |
| sham-grown-checkpoint | 718122048 | 2026-10-11 | model_grow | أفضل نقطة حفظ بالقياس بعد التكبير (طبقات أكثر وسياق أطول، الدالة محفوظة) — يفضّلها الدمج والمدرّب الحي عند التعادل |
| sham-image-tokenizer-v2-checkpoint | 144015040 | 2026-10-15 | lightning_probe | مُرمِّز الصورة v2 (128 بكسل، 64 رمزاً، يُدرَّب على CPU في استوديو Lightning) |
| sham-image-tokenizer-hd-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الصورة عالي الدقة (384 بكسل، 576 رمزاً)؛ سلالة جديدة لا تمس المُرمِّز المخدوم، يدرّبها استوديو ModelScope (وظيفة codec) |
| sham-audio-tokenizer-v2-checkpoint | 34972869 | 2026-10-15 | lightning_probe | مُرمِّز الصوت v2 (كل مقاطع كل مقطع، يُدرَّب على CPU في استوديو Lightning) |
| sham-chat-arabic-sft-checkpoint | 579344243 | 2026-10-27 | arabic_sft | نقطة دفتر SFT العربي المنفصل (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-repair-remerge-checkpoint | 3704052342 | 2026-11-08 | repair_remerge | ناتج أداة الاسترجاع والإصلاح وإعادة الدمج (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-runtime-creds | — | غير موجودة | any | مجموعة خاصة بملف اعتماد كاكل للنسخ المدفوعة بالواجهة (أسرار — لا تُرفق إلا بدفاتر خاصة؛ لا أوزان فيها) |
| sham-v2-checkpoint | — | غير موجودة | sham_v2_train | نقطة حفظ سلالة شام v2 (جسم المانح المنقول + صفوف الوسائط المدرَّبة)؛ سلالة منفصلة بمُرمِّز المانح فلا تُدمج مع السلالة القديمة |
| sham-media-refined | 35091277 | 2026-11-11 | decoder_refine | مفكّ الصورة والصوت المصقول وحده (الترميز والقاموس كما هما بالضبط) — يُعتمد في الاستوديو فقط إذا طابق ترميز النموذج المدموج |
| sham-v2-candidate-checkpoint | — | غير موجودة | sham_v2_candidate_train | نقطة حفظ السلالة المرشحة لشام v2 (جسم SmolLM3-3B المنقول)؛ لا تحلّ محل المخدومة إلا عبر sham_v2_switch.py بقياس |
| sham-v2-motion-tokenizer | — | غير موجودة | sham_v2_motion_tokenizer | مُرمِّز الحركة لفيديو شام برو (motion_tokenizer.pt بجانب نقطة الحفظ في novaai2026/sham-v2)؛ يُنشر فقط إذا تغلّب على عرض الشرائح على مقاطع محجوزة |
| sham-v2-runtime-wheels | — | غير موجودة | sham_v2_runtime_wheels | عجلة llama-cpp-python المثبّتة (sha256) داخل novaai2026/sham-v2 تحت runtime_wheels/ لفك ترميز q4_k_m؛ استوديو cn لا يقرأ أصول GitHub |
| sham-v2-motion-rows | — | غير موجودة | sham_v2_motion_rows | صفوف رموز الحركة الخاصة بشام برو (motion_rows.pt بجانب نقطة الحفظ في novaai2026/sham-v2)؛ تُطبَّق عند التحميل فقط إذا طابقت نقطة الحفظ ومُرمِّز الحركة |
| Jonjithup/sham-v2 | — | غير موجودة | sham_v2_mirror_ai | نسخة شام برو على المنصة الدولية (استوديو الخدمة): مرآة من novaai2026/sham-v2، تُنسخ الملفات المتغيرة فقط ولا يُحذف شيء — الكاتب الوحيد هو سير عمل المرآة |
| Jonjithup/sham2-tldm-head | — | غير موجودة | sham_v2_mirror_ai | نسخة رأس T-LDM على المنصة الدولية: مرآة من novaai2026/sham2-tldm-head — الكاتب الوحيد هو سير عمل المرآة |
| sham-crawl-ms3 | 792160056 | 2026-11-25 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms3-corpus | 23812631 | 2026-11-25 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-nb1 | 791934456 | 2026-11-22 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-nb1-corpus | 6863812 | 2026-11-22 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms2 | 792605661 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-lightning-corpus | 528314 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms2-corpus | 723815 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-lightning | 791545617 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-audio-202610110834 | 402363586 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111111 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |

## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)
- sham-media-audio-202610110834: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111111: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-11-26 21:05 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 229 (الخطوة النهائية: 95,916)
متوسط الخسارة أول 10 خطوات: 4.9632
متوسط الخسارة آخر 10 خطوات: 4.0038
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.429 → بعد 2.137 (-0.292)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (2.170) فاستُعيدت أفضل أوزان وُجدت (بعد 300 دفعة، 2.137) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 4.064
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-26 13:21 UTC — 🕸 الزاحف العام (GitHub): 78,502 وثيقة، 99.5 مليون حرف في 5.2 ساعة | crossref:504
```
🕸 الزاحف العام (GitHub): 78,502 وثيقة، 99.5 مليون حرف في 5.2 ساعة | crossref:50465 hackernews:26651 arxiv:753 ia_books:338 github:250 europepmc:29 verified_tests:9 stackexchange:7 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-26 13:08 UTC — 🤖 مدرّب CPU على GitHub: 885 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jo
```
🤖 مدرّب CPU على GitHub: 885 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 1.000
```
### 2026-11-26 10:47 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 261 (الخطوة النهائية: 94,542)
متوسط الخسارة أول 10 خطوات: 3.9689
متوسط الخسارة آخر 10 خطوات: 3.2840
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.674 → بعد 1.687 (-0.987)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (1.698) فاستُعيدت أفضل أوزان وُجدت (بعد 800 دفعة، 1.687) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.267
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-26 03:58 UTC — 🧠 تقرير جلسة شام — المسار الرئيسي (CPU ⚠ لم يُعثر على GPU — الجلسة أبطأ بنحو 25 
```
🧠 تقرير جلسة شام — المسار الرئيسي (CPU ⚠ لم يُعثر على GPU — الجلسة أبطأ بنحو 25 ضعفاً)
خطوات تدريب حقيقية هذه الجلسة: 191 (الخطوة النهائية: 63,530)
متوسط الخسارة أول 10 خطوات: 3.3181
متوسط الخسارة آخر 10 خطوات: 3.1034
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.585 → بعد 2.562 (-0.023)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (2.693) فاستُعيدت أفضل أوزان وُجدت (بعد 100 دفعة، 2.562) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.259
نُشر إلى: jonsnowjonsnow/sham-checkpoint
```
### 2026-11-26 02:50 UTC — 🕸 الزاحف العام (GitHub): 79,067 وثيقة، 100.4 مليون حرف في 5.2 ساعة | crossref:50
```
🕸 الزاحف العام (GitHub): 79,067 وثيقة، 100.4 مليون حرف في 5.2 ساعة | crossref:50791 hackernews:26827 arxiv:727 github:366 ia_books:292 europepmc:61 verified_tests:3 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
