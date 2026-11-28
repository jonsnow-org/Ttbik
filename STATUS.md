# حالة مشروع شام — 2026-11-28 11:35 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ℹ دفتر أساسي بخطأ قديم (آخر تشغيل 2026-10-11): مسار ترميز الصوت 3 (audio_tokenizer) — لا يُعدّ عطلاً اليوم؛ تنبّه مجموعات الخط الرئيسي إن توقف التقدم
- ⚠ sham-multimodal-checkpoint لم تُحدَّث منذ 22 أيام (يكتبها: المرحلة الثانية: إضافة الصورة والصوت)
- ⚠ sham-chat-checkpoint لم تُحدَّث منذ 20 أيام (يكتبها: مرحلة التجميع والمحادثة)
- ⚠ sham-image-tokenizer-checkpoint لم تُحدَّث منذ 20 أيام (يكتبها: مسار ترميز الصورة)
- ⚠ sham-audio-tokenizer-checkpoint لم تُحدَّث منذ 20 أيام (يكتبها: مسار ترميز الصوت)

**المُعيد التلقائي لدفاتر كاكل:** حي — المفتاح RESTARTER_LIVE=1

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
- running | المرحلة الأولى 7 | الدور: primary | آخر تشغيل 2026-11-28
- error | المرحلة الثالثة 5 | الدور: duplicate | آخر تشغيل 2026-11-28
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-11-28 | GPU
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-11-28 | GPU
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- running | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-11-28
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: duplicate | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +4 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-11-28T11:35 in_progress ، 2026-11-28T07:56 success
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-11-28T11:35 success ، 2026-11-28T11:22 success ، 2026-11-28T10:03 success ، 2026-11-28T09:31 success
- Sham v2 host image: build check (CPU container for a second free host; no push, no secrets): 2026-11-28T11:33 success
- Sham Pro live repeat probe (read-only): 2026-11-28T11:33 success
- Sham CI (contract + self-tests, read-only): 2026-11-28T11:33 success ، 2026-11-28T08:52 success
- Sham Kaggle Inspect (read-only): 2026-11-28T11:28 success ، 2026-11-28T11:20 success ، 2026-11-28T08:23 success
- Sham v2 live capability smoke test: 2026-11-28T10:10 skipped
- Sham v2 mirror to the international site (model + T-LDM head, cn -> ai): 2026-11-28T09:41 failure ، 2026-11-28T02:39 success
- Sham v2 signed runtime code sync: 2026-11-28T09:39 success
- Sham Token Shards (free CPU runner): 2026-11-28T08:30 success
- Sham distillation network (teachers -> verified records -> the Kaggle pool every trainer reads): 2026-11-28T07:56 success
- Sham Collector (free CPU runner): 2026-11-28T07:40 in_progress
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-11-28T07:32 in_progress
- Sham v2 stage queue (the four focused notebooks, one after another): 2026-11-28T04:13 success
- Sham Merge + Repair + Eval (free CPU runner): 2026-11-28T00:42 success ، 2026-11-27T15:38 failure ، 2026-11-27T01:09 cancelled ، 2026-11-26T15:50 cancelled

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- 2026-11-28T09:41 «Sham v2 mirror to the international site (model + T-LDM head, cn -> ai)» — الخطوة: mirror ← Mirror — https://github.com/jonsnow-org/Ttbik/actions/runs/46131654659
- 2026-11-27T15:38 «Sham Merge + Repair + Eval (free CPU runner)» — الخطوة: غير معروفة — https://github.com/jonsnow-org/Ttbik/actions/runs/46026752982

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 4238119679 | 2026-11-26 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 145722206 | 2026-11-08 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35875133 | 2026-11-07 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 26332462 | 2026-11-08 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-motion-tokenizer-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الحركة الأصلي (MotionTokenizer) لمسار الفيديو — يرمّز الفرق بين الإطارات كرموز حركة، فلا يصبح الفيديو عرض شرائح |
| sham-multimodal-checkpoint | 582049080 | 2026-11-05 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 581083846 | 2026-11-08 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 4235763767 | 2026-11-28 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 4235480535 | 2026-11-15 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 794580475 | 2026-11-28 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 523115 | 2026-11-28 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 719464296 | 2026-11-28 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 586262 | 2026-11-28 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-ms1 | — | غير موجودة | ms_studio_trainer | مدرّب Sham على استوديو ModelScope (نموذج) |
| sham-crawl-ms1-corpus | — | غير موجودة | ms_studio_trainer | نصوص مدرّب استوديو ModelScope |
| sham-crawl-gh-collect-corpus | 745123296 | 2026-11-28 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-curated-ar-books | 176853496 | 2026-11-12 | ar_books_ingest | كتب عربية نظيفة (هنداوي، CC BY 4.0) مقسّمة وثائق للتدريب |
| sham-merged-checkpoint | 718257187 | 2026-11-28 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 11002 | 2026-11-28 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | 277 | 2026-09-27 | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 763 | 2026-11-28 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 529937143 | 2026-11-28 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
| sham-crawl-modal | — | غير موجودة | modal_gpu | نموذج جلسات GPU على Modal (مرشّح لبوابة الدمج) |
| sham-grown-checkpoint | 718122048 | 2026-10-11 | model_grow | أفضل نقطة حفظ بالقياس بعد التكبير (طبقات أكثر وسياق أطول، الدالة محفوظة) — يفضّلها الدمج والمدرّب الحي عند التعادل |
| sham-image-tokenizer-v2-checkpoint | 144015040 | 2026-10-15 | lightning_probe | مُرمِّز الصورة v2 (128 بكسل، 64 رمزاً، يُدرَّب على CPU في استوديو Lightning) |
| sham-image-tokenizer-hd-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الصورة عالي الدقة (384 بكسل، 576 رمزاً)؛ سلالة جديدة لا تمس المُرمِّز المخدوم، يدرّبها استوديو ModelScope (وظيفة codec) |
| sham-audio-tokenizer-v2-checkpoint | 34972869 | 2026-10-15 | lightning_probe | مُرمِّز الصوت v2 (كل مقاطع كل مقطع، يُدرَّب على CPU في استوديو Lightning) |
| sham-chat-arabic-sft-checkpoint | 579344243 | 2026-10-27 | arabic_sft | نقطة دفتر SFT العربي المنفصل (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-repair-remerge-checkpoint | 3704052342 | 2026-11-08 | repair_remerge | ناتج أداة الاسترجاع والإصلاح وإعادة الدمج (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-runtime-creds | 493 | 2026-10-16 | any | مجموعة خاصة بملف اعتماد كاكل للنسخ المدفوعة بالواجهة (أسرار — لا تُرفق إلا بدفاتر خاصة؛ لا أوزان فيها) |
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
| sham-crawl-ms2 | 792605661 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-nb1-corpus | 6863812 | 2026-11-22 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-lightning-corpus | 528314 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms2-corpus | 723815 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-lightning | 791545617 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-image-202610111111 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111018 | 1060576070 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-audio-202610111031 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110940 | 393669296 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110733 | 134444553 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110630 | 374725918 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111201 | 129398149 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111029 | 127678650 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110813 | 404805261 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111209 | 129393589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111148 | 128708430 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110834 | 402363586 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110919 | 394928871 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111025 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110610 | 377640881 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110604 | 377708247 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110958 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110752 | 398679047 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110605 | 148376346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111130 | 129692253 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110650 | 379823987 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111021 | 131035980 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111041 | 127975318 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111037 | 129250366 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110732 | 378321201 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110606 | 377530614 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111519 | 128976330 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111557 | 129561512 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111056 | 128764385 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111002 | 135942947 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111510 | 129788524 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111215 | 128791138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110921 | 136080898 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111501 | 129810937 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110652 | 133484773 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111048 | 128940003 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110712 | 134810216 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110711 | 379620779 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111618 | 129662473 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111034 | 128313062 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111123 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111527 | 129560681 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111142 | 128936589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111044 | 129023022 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111536 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111453 | 129736346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110900 | 134992165 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110754 | 136288905 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111547 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110631 | 134794961 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110608 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111446 | 129385094 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111154 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111117 | 128929395 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111106 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111100 | 129039677 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111052 | 128920140 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110941 | 136392138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110836 | 136602207 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110815 | 135504427 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110611 | 136582608 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110602 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111606 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111136 | 129026168 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |

## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)
- sham-media-image-202610111111: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111018: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610111031: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110940: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110733: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110630: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111201: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111029: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110813: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111209: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111148: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110834: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110919: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610111025: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110610: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110604: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110958: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110752: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110605: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111130: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110650: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111021: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111041: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111037: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110732: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110606: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111519: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111557: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111056: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111002: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111510: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111215: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110921: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111501: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110652: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111048: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110712: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110711: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111618: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111034: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111123: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111527: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111142: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111044: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111536: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111453: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110900: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110754: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111547: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110631: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110608: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111446: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111154: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111117: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111106: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111100: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111052: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110941: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110836: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110815: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110611: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110602: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111606: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111136: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-11-28 09:26 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 245 (الخطوة النهائية: 95,974)
متوسط الخسارة أول 10 خطوات: 3.9112
متوسط الخسارة آخر 10 خطوات: 3.5941
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.814 → بعد 2.751 (-0.063)
🛡 الحارس: نهاية الجلسة هي الأفضل أو ضمن الهامش (أفضل 2.759) — لا استعادة.
خسارة التدريب في آخر 50 خطوة: 3.439
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-28 03:47 UTC — 🧩 الدمج بالكلمات
```
🧩 الدمج بالكلمات
الأساس: sham-grown-checkpoint (خطوة 95,940)
الحصيلة الكلية على الرأس: النص: تحسّن 0.1%، المحادثة: تحسّن 38.7%، الوسائط: تحسّن 7.6%
المقبول (9):
• sham-multimodal-checkpoint (الوسائط المتعددة): قُبل بنسبة 15% — النص: تحسّن 0.1%, المحادثة: تحسّن 3.5%, الوسائط: تحسّن 1.9%
• sham-chat-checkpoint (المحادثة): قُبل بنسبة 5% — النص: تراجع 0.2%, المحادثة: تحسّن 0.7%, الوسائط: تراجع 0.1%
• sham-checkpoint: قُبل بنسبة 50% — النص: تحسّن 2.6%, المحادثة: تحسّن 20.5%, الوسائط: تراجع 1.6%
• sham-cpu-track-checkpoint-v2 (مسار CPU العام): قُبل بنسبة 15% — النص: تراجع 0.2%, المحادثة: تحسّن 2.2%, الوسائط: تراجع 0.1%
• sham-crawl-checkpoint (ما جمعه الزاحف من الإنترنت): قُبل بنسبة 30% — النص: تراجع 0.6%, المحادثة: تحسّن 7.3%, الوسائط: تحسّن 3.9%
• sham-crawl-lightning (ما جمعه الزاحف من الإنترنت): قُبل بنسبة 5% — النص: تحسّن 0.2%, المحادثة: تراجع 0.5%, الوسائط: تحسّن 0.5%
• sham-crawl-ms2 (ما جمعه الزاحف من الإنترنت): قُبل بنسبة 10% — النص: تراجع 0.9%, المحادثة: تحسّن 3.7%, الوسائط: تحسّن 0.5%
• sham-crawl-ms3 (ما جمعه الزاحف من الإنترنت): قُبل بنسبة 30% — النص: تراجع 0.5%, المحادثة: تحسّن 5.3%, الوسائط: تحسّن 1.5%
• sham-crawl-nb1 (ما جمعه الزاحف من الإنترنت): قُبل بنسبة 30% — النص: تراجع 0.5%, المحادثة: تحسّن 3.3%, الوسائط: تحسّن 1.3%
المرفوض (3):
• sham-crawl-agent (ما جمعه الزاحف من الإنترنت): رُفض — ساءت النص 0.3% والمحادثة 0.3% حتى في أخف نسبة
• sham-crawl-gh (ما جمعه الزاحف من الإنترنت): رُفض — ساءت النص 0.1% والمحادثة 0.3% حتى في أخف نسبة
• sham-crawl-xlive (ما جمعه الزاحف من الإنترنت): رُفض — ساءت النص 0.3% والمحادثة 0.7% حتى في أخف نسبة
تالفة أو بعيدة جدًا (لا تصلح للدمج): sham-crawl-agent، sham-crawl-xlive
لم تدخل الدمج هذه المرة (10) ولماذا:
• sham-crawl-ms1: مؤجَّل للتشغيل القادم (حدّ المصادر في التشغيل الواحد)
• sham-crawl-ms10: مؤجَّل للتشغيل القادم (حدّ المص
```
### 2026-11-28 02:23 UTC — 🕸 الزاحف العام (GitHub): 82,618 وثيقة، 104.5 مليون حرف في 5.2 ساعة | crossref:52
```
🕸 الزاحف العام (GitHub): 82,618 وثيقة، 104.5 مليون حرف في 5.2 ساعة | crossref:52982 hackernews:28082 arxiv:853 github:379 ia_books:201 europepmc:97 stackexchange:14 verified_tests:10 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-28 02:05 UTC — 🤖 مدرّب CPU على GitHub: 1,632 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 1,632 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.879
```
### 2026-11-28 00:40 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 209 (الخطوة النهائية: 95,729)
متوسط الخسارة أول 10 خطوات: 3.3771
متوسط الخسارة آخر 10 خطوات: 3.9793
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.891 → بعد 2.808 (-0.084)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (2.879) فاستُعيدت أفضل أوزان وُجدت (بعد 100 دفعة، 2.808) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.639
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-27 16:11 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 330 (الخطوة النهائية: 95,520)
متوسط الخسارة أول 10 خطوات: 5.4180
متوسط الخسارة آخر 10 خطوات: 3.9904
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.295 → بعد 1.986 (-0.310)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (2.081) فاستُعيدت أفضل أوزان وُجدت (بعد 300 دفعة، 1.986) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 4.016
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
