# حالة مشروع شام — 2026-11-13 11:07 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ℹ دفتر أساسي بخطأ قديم (آخر تشغيل 2026-10-11): مسار ترميز الصوت 3 (audio_tokenizer) — لا يُعدّ عطلاً اليوم؛ تنبّه مجموعات الخط الرئيسي إن توقف التقدم
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham Collector (free CPU runner)» (لم يبدأ بعد؟)
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham CPU Trainer (free CPU runner, slow and continuous)» (لم يبدأ بعد؟)
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham Merge + Repair + Eval (free CPU runner)» (لم يبدأ بعد؟)
- ⚠ sham-multimodal-checkpoint لم تُحدَّث منذ 7 أيام
- ⚠ sham-chat-checkpoint لم تُحدَّث منذ 5 أيام
- ⚠ sham-image-tokenizer-checkpoint لم تُحدَّث منذ 5 أيام
- ⚠ sham-audio-tokenizer-checkpoint لم تُحدَّث منذ 5 أيام

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: running
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: error — تقدم: {'samples_consumed': 363104, 'step': 90217, 'last_run_sources': {'clartts': 1000}, 'codebook_usage': 2012, 'recon': 0.009080708482639586}
- ✅ مسار جمع وترميز الفيديو — دفتر: complete — تقدم: {'videos_consumed': 6267}
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
- cancelAcknowledged | المرحلة الأولى 3 | الدور: duplicate | آخر تشغيل 2026-11-12
- error | المرحلة الأولى 5 | الدور: duplicate | آخر تشغيل 2026-11-13
- error | المرحلة الأولى 4 | الدور: duplicate | آخر تشغيل 2026-11-12
- running | المرحلة الأولى 6 | الدور: primary | آخر تشغيل 2026-11-13
- error | المرحلة الثالثة 5 | الدور: duplicate | آخر تشغيل 2026-11-13
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-11-13
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-11-13
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- running | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-11-13
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: duplicate | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +4 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-11-13T11:07 in_progress
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-11-13T10:56 success ، 2026-11-13T10:50 success ، 2026-11-13T10:28 success ، 2026-11-13T09:08 success
- Sham CI (contract + self-tests, read-only): 2026-11-13T10:30 success ، 2026-11-13T08:41 success ، 2026-11-13T08:39 success ، 2026-11-13T08:25 success
- Sham trainer Studios status (read-only, cn): 2026-11-13T10:25 success ، 2026-11-13T09:50 success ، 2026-11-13T09:08 success ، 2026-11-13T08:15 success
- Sham ModelScope Studio (host + worker): 2026-11-13T09:39 success
- Sham v2 live capability smoke test: 2026-11-13T08:37 skipped ، 2026-11-13T07:56 skipped
- Sham v2 signed runtime code sync: 2026-11-13T08:30 success ، 2026-11-13T07:48 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 4241426484 | 2026-11-11 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 145722206 | 2026-11-08 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35875133 | 2026-11-07 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 26332462 | 2026-11-08 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-motion-tokenizer-checkpoint | — | غير موجودة | ms_studio_trainer | مُرمِّز الحركة الأصلي (MotionTokenizer) لمسار الفيديو — يرمّز الفرق بين الإطارات كرموز حركة، فلا يصبح الفيديو عرض شرائح |
| sham-multimodal-checkpoint | 582049080 | 2026-11-05 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 581083846 | 2026-11-08 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 4237639229 | 2026-11-13 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 4238976894 | 2026-11-12 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 794196289 | 2026-11-13 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 725284 | 2026-11-13 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 720398063 | 2026-11-13 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 823717 | 2026-11-13 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-ms1 | — | غير موجودة | ms_studio_trainer | مدرّب Sham على استوديو ModelScope (نموذج) |
| sham-crawl-ms1-corpus | — | غير موجودة | ms_studio_trainer | نصوص مدرّب استوديو ModelScope |
| sham-crawl-gh-collect-corpus | 0 | 2026-11-13 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-curated-ar-books | 176853496 | 2026-11-12 | ar_books_ingest | كتب عربية نظيفة (هنداوي، CC BY 4.0) مقسّمة وثائق للتدريب |
| sham-merged-checkpoint | 580217251 | 2026-11-13 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 11929 | 2026-11-13 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | 277 | 2026-09-27 | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 757 | 2026-11-13 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 529877126 | 2026-11-13 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
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
| sham-crawl-lightning-corpus | 528314 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-lightning | 791545617 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-audio-202610110958 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111111 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111106 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111018 | 1060576070 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-audio-202610110610 | 377640881 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110604 | 377708247 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111201 | 129398149 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111136 | 129026168 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-ms2 | 0 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-audio-202610111031 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110940 | 393669296 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111025 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110752 | 398679047 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110630 | 374725918 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110733 | 134444553 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111021 | 131035980 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111154 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111123 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110631 | 134794961 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-ms2-corpus | 386788 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-audio-202610110650 | 379823987 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110919 | 394928871 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110834 | 402363586 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110815 | 135504427 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111142 | 128936589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111130 | 129692253 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111117 | 128929395 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110813 | 404805261 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110732 | 378321201 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111034 | 128313062 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110941 | 136392138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110652 | 133484773 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110605 | 148376346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111606 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110606 | 377530614 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110711 | 379620779 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110754 | 136288905 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111510 | 129788524 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111215 | 128791138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111618 | 129662473 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111557 | 129561512 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110608 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110900 | 134992165 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111209 | 129393589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111048 | 128940003 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111536 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111527 | 129560681 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111501 | 129810937 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111037 | 129250366 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111446 | 129385094 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110602 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111056 | 128764385 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111052 | 128920140 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110712 | 134810216 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111029 | 127678650 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110611 | 136582608 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110836 | 136602207 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111002 | 135942947 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111547 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111519 | 128976330 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111453 | 129736346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111148 | 128708430 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111100 | 129039677 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111044 | 129023022 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111041 | 127975318 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110921 | 136080898 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-ms3-corpus | 789703 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-ms3 | 792593798 | 2026-11-13 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |

## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)
- sham-media-audio-202610110958: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111111: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111106: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111018: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110610: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110604: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111201: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111136: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111031: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110940: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610111025: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110752: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110630: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110733: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111021: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111154: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111123: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110631: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110650: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110919: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110834: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110815: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111142: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111130: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111117: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110813: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110732: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111034: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110941: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110652: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110605: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111606: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110606: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110711: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110754: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111510: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111215: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111618: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111557: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110608: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110900: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111209: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111048: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111536: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111527: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111501: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111037: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111446: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110602: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111056: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111052: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110712: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111029: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110611: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110836: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111002: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111547: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111519: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111453: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111148: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111100: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111044: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111041: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110921: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-11-13 07:24 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-multimodal-checkpoint (خطوة 84,755)
قبل: text=4.837, chat=4.220, media=3.751
بعد: text=4.837, chat=4.220, media=3.751
📏 sham-chat-checkpoint (خطوة 85,917) وحده على الميزان: text=6.437, chat=5.020, media=3.735 | الأساس: text=4.837, chat=4.220, media=3.751
📏 sham-checkpoint (خطوة 61,840) وحده على الميزان: text=4.906, chat=8.010, media=8.709 | الأساس: text=4.837, chat=4.220, media=3.751
📏 sham-cpu-track-checkpoint-v2 (خطوة 62,951) وحده على الميزان: text=4.828, chat=10.212, media=8.707 | الأساس: text=4.837, chat=4.220, media=3.751
قبل الدمج: text=4.837, chat=4.220, media=3.751
✅ sham-chat-checkpoint (خطوة 85,917): دُمج بنسبة 0.15 — text=4.880, chat=4.137, media=3.723
✅ sham-checkpoint (خطوة 61,840): دُمج بنسبة 0.10 — text=4.824, chat=3.977, media=3.753
✅ sham-cpu-track-checkpoint-v2 (خطوة 62,951): دُمج بنسبة 0.03 — text=4.807, chat=3.951, media=3.775
📏 sham-research-track-checkpoint-v2 (خطوة 62,761) وحده على الميزان: text=6.632, chat=11.756, media=7.997 | الأساس: text=4.837, chat=4.220, media=3.751
📏 sham-crawl-checkpoint (خطوة 61,802) وحده على الميزان: text=4.436, chat=5.234, media=5.926 | الأساس: text=4.837, chat=4.220, media=3.751
📏 sham-crawl-agent (خطوة 42,893) وحده على الميزان: text=10.464, chat=8.252, media=9.647 | الأساس: text=4.837, chat=4.220, media=3.751
قبل الدمج: text=4.807, chat=3.951, media=3.775
❌ sham-research-track-checkpoint-v2 (خطوة 62,761): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.01): text 4.807→4.806 (-0.0%), chat 3.951→3.945 (-0.1%), media 3.775→3.783 (+0.2%) — المنحنى (نسبة: تغيّر كل مهارة %): 0.01: t-0.0 c-0.1 m+0.2 | 0.02: t-0.0 c-0.2 m+0.5 | 0.03: t-0.0 c-0.3 m+0.7 | 0.05: t+0.0 c-0.3 m+1.4 | 0.1: t+0.3 c+0.3 m+4.1 | 0.15: t+0.8 c+2.4 m+8.3 | 0.3: t+3.5 c+18.9 m+30.4 | 0.5: t+9.7 c+
```
### 2026-11-13 04:46 UTC — 🕸 الزاحف العام (GitHub): 96,459 وثيقة، 120.6 مليون حرف في 5.2 ساعة | crossref:63
```
🕸 الزاحف العام (GitHub): 96,459 وثيقة، 120.6 مليون حرف في 5.2 ساعة | crossref:63463 hackernews:32179 arxiv:475 github:256 ia_books:54 gutenberg:18 stackexchange:10 europepmc:4 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-13 04:28 UTC — 🤖 مدرّب CPU على GitHub: 1,692 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 1,692 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.852
```
### 2026-11-13 01:56 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-merged-checkpoint (يكمل من ناتجه السابق) (خطوة 61,555)
قبل: text=4.624, chat=2.005, media=7.246
بعد: text=4.624, chat=2.005, media=7.246
⏭ sham-multimodal-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 9fae7074)
⏭ sham-chat-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 8b07800f)
⏭ sham-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة aa7198f4)
⏭ sham-cpu-track-checkpoint-v2: النقطة نفسها جُرّبت سابقاً (البصمة d4a6fc13)
📏 sham-research-track-checkpoint-v2 (خطوة 62,761) وحده على الميزان: text=6.399, chat=5.248, media=9.602 | الأساس: text=4.624, chat=2.005, media=7.246
📏 sham-crawl-checkpoint (خطوة 62,277) وحده على الميزان: text=4.217, chat=3.850, media=9.729 | الأساس: text=4.624, chat=2.005, media=7.246
⏭ sham-crawl-agent: النقطة نفسها جُرّبت سابقاً (البصمة ba84359a)
📏 sham-crawl-gh (خطوة 62,589) وحده على الميزان: text=4.624, chat=2.005, media=7.246 | الأساس: text=4.624, chat=2.005, media=7.246
قبل الدمج: text=4.624, chat=2.005, media=7.246
❌ sham-research-track-checkpoint-v2 (خطوة 62,761): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.01): text 4.624→4.620 (-0.1%), chat 2.005→2.011 (+0.3%), media 7.246→7.251 (+0.1%) — المنحنى (نسبة: تغيّر كل مهارة %): 0.01: t-0.1 c+0.3 m+0.1 | 0.02: t-0.1 c+0.7 m+0.1 | 0.03: t-0.2 c+1.2 m+0.2 | 0.05: t-0.2 c+2.2 m+0.3 | 0.1: t-0.1 c+5.9 m+0.5 | 0.15: t+0.4 c+11.0 m+0.8 | 0.3: t+3.6 c+32.4 m+8.3 | 0.5: t+10.2 c+68.8 m+22.6 | 0.75: t+20.6 c+113.9 m+27.9 | 1: t+38.6 c+161.5 m+30.4
❌ sham-crawl-checkpoint (خطوة 62,277): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.01): text 4.624→4.613 (-0.2%), chat 2.005→2.014 (+0.5%), media 7.246→7.262 (+0.2%) — المنحنى (نسبة: تغيّر كل مهارة %): 0.01: t-0.2 c+0.5 m+0.2 | 0.02: t-0.5 c+1.0 m+0.4 | 0.03: t-0.7 c+1.5 m+0.7 | 0.05: t-1.2 
```
### 2026-11-13 00:26 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 326 (الخطوة النهائية: 62,951)
متوسط الخسارة أول 10 خطوات: 3.9099
متوسط الخسارة آخر 10 خطوات: 3.6379
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 3.238 → بعد 3.122 (-0.116)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (3.447) فاستُعيدت أفضل أوزان وُجدت (بعد 100 دفعة، 3.122) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.709
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-12 20:19 UTC — 🕸 الزاحف العام (GitHub): 84,204 وثيقة، 107.7 مليون حرف في 5.2 ساعة | crossref:53
```
🕸 الزاحف العام (GitHub): 84,204 وثيقة، 107.7 مليون حرف في 5.2 ساعة | crossref:53577 hackernews:28881 github:705 arxiv:645 ia_books:149 gutenberg:137 europepmc:81 stackexchange:29 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
