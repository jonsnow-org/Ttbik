# حالة مشروع شام — 2026-11-10 21:20 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ℹ دفتر أساسي بخطأ قديم (آخر تشغيل 2026-10-11): مسار ترميز الصوت 3 (audio_tokenizer) — لا يُعدّ عطلاً اليوم؛ تنبّه مجموعات الخط الرئيسي إن توقف التقدم
- ⚠ sham-multimodal-checkpoint لم تُحدَّث منذ 5 أيام

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
- queued | المرحلة الأولى 4 | الدور: duplicate | آخر تشغيل 2026-11-09
- error | المرحلة الأولى 3 | الدور: duplicate | آخر تشغيل 2026-11-09
- running | المرحلة الأولى 5 | الدور: primary | آخر تشغيل 2026-11-10
- error | المرحلة الثالثة 5 | الدور: duplicate | آخر تشغيل 2026-11-10
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-11-10
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-11-10
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- running | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-11-10
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: duplicate | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +4 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Vault (checkpoint backup to ModelScope): 2026-11-10T21:24 in_progress ، 2026-11-10T11:40 success
- Sham decoder refine (image / audio tokenizer decoder only): 2026-11-10T21:24 queued ، 2026-11-10T11:43 success
- Sham Status (supervision snapshot): 2026-11-10T21:19 in_progress ، 2026-11-10T14:58 success
- Sham CI (contract + self-tests, read-only): 2026-11-10T20:47 success ، 2026-11-10T20:11 success ، 2026-11-10T15:51 success
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-11-10T20:25 success ، 2026-11-10T16:28 success ، 2026-11-10T16:17 success ، 2026-11-10T13:35 success
- Sham Token Shards (free CPU runner): 2026-11-10T20:03 in_progress ، 2026-11-10T07:48 success
- Sham v2 stage queue (the four focused notebooks, one after another): 2026-11-10T19:58 success ، 2026-11-10T12:30 success
- Sham Collector (free CPU runner): 2026-11-10T19:40 in_progress ، 2026-11-10T07:11 success
- Sham Kaggle Inspect (read-only): 2026-11-10T17:15 success ، 2026-11-10T07:42 success
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-11-10T14:44 success
- Sham Merge + Repair + Eval (free CPU runner): 2026-11-10T13:48 success
- Sham knowledge bank (build from the crawlers' data, push to ModelScope): 2026-11-10T12:57 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 4248308096 | 2026-11-10 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 145722206 | 2026-11-08 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35875133 | 2026-11-07 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 26332462 | 2026-11-08 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-motion-tokenizer-checkpoint | — | غير موجودة | video_tokenizer | مُرمِّز الحركة الأصلي (MotionTokenizer) لمسار الفيديو — يرمّز الفرق بين الإطارات كرموز حركة، فلا يصبح الفيديو عرض شرائح |
| sham-multimodal-checkpoint | 582049080 | 2026-11-05 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 581083846 | 2026-11-08 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 4236214924 | 2026-11-10 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 4237767922 | 2026-11-10 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 794918460 | 2026-11-10 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 617670 | 2026-11-10 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 792907563 | 2026-11-10 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 488699 | 2026-11-10 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-gh-collect-corpus | 0 | 2026-11-10 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-merged-checkpoint | 719058903 | 2026-11-10 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 12651 | 2026-11-10 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | — | غير موجودة | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 763 | 2026-11-10 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 525275397 | 2026-11-10 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
| sham-crawl-modal | — | غير موجودة | modal_gpu | نموذج جلسات GPU على Modal (مرشّح لبوابة الدمج) |
| sham-grown-checkpoint | 718122048 | 2026-10-11 | model_grow | أفضل نقطة حفظ بالقياس بعد التكبير (طبقات أكثر وسياق أطول، الدالة محفوظة) — يفضّلها الدمج والمدرّب الحي عند التعادل |
| sham-image-tokenizer-v2-checkpoint | 144015040 | 2026-10-15 | lightning_probe | مُرمِّز الصورة v2 (128 بكسل، 64 رمزاً، يُدرَّب على CPU في استوديو Lightning) |
| sham-audio-tokenizer-v2-checkpoint | 34972869 | 2026-10-15 | lightning_probe | مُرمِّز الصوت v2 (كل مقاطع كل مقطع، يُدرَّب على CPU في استوديو Lightning) |
| sham-chat-arabic-sft-checkpoint | 579344243 | 2026-10-27 | arabic_sft | نقطة دفتر SFT العربي المنفصل (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-repair-remerge-checkpoint | 3704052342 | 2026-11-08 | repair_remerge | ناتج أداة الاسترجاع والإصلاح وإعادة الدمج (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-runtime-creds | 493 | 2026-10-16 | any | مجموعة خاصة بملف اعتماد كاكل للنسخ المدفوعة بالواجهة (أسرار — لا تُرفق إلا بدفاتر خاصة؛ لا أوزان فيها) |
| sham-v2-checkpoint | — | غير موجودة | sham_v2_train | نقطة حفظ سلالة شام v2 (جسم المانح المنقول + صفوف الوسائط المدرَّبة)؛ سلالة منفصلة بمُرمِّز المانح فلا تُدمج مع السلالة القديمة |
| sham-media-refined | 144023228 | 2026-10-18 | decoder_refine | مفكّ الصورة والصوت المصقول وحده (الترميز والقاموس كما هما بالضبط) — يُعتمد في الاستوديو فقط إذا طابق ترميز النموذج المدموج |
| sham-v2-candidate-checkpoint | — | غير موجودة | sham_v2_candidate_train | نقطة حفظ السلالة المرشحة لشام v2 (جسم SmolLM3-3B المنقول)؛ لا تحلّ محل المخدومة إلا عبر sham_v2_switch.py بقياس |
| sham-crawl-lightning-corpus | 528314 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-lightning | 791545617 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-image-202610111606 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111111 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111031 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111025 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111018 | 1060576070 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-image-202610111618 | 129662473 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111557 | 129561512 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110606 | 377530614 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110608 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110650 | 379823987 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110711 | 379620779 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110752 | 398679047 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110900 | 134992165 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110958 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110919 | 394928871 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111209 | 129393589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111048 | 128940003 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111130 | 129692253 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111106 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111142 | 128936589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111117 | 128929395 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110834 | 402363586 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110940 | 393669296 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110630 | 374725918 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110813 | 404805261 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110733 | 134444553 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111536 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111021 | 131035980 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111527 | 129560681 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110732 | 378321201 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111501 | 129810937 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111037 | 129250366 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110610 | 377640881 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111446 | 129385094 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110604 | 377708247 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110602 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111056 | 128764385 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111052 | 128920140 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110712 | 134810216 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111201 | 129398149 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111136 | 129026168 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111034 | 128313062 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110754 | 136288905 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111029 | 127678650 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110611 | 136582608 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |

## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)
- sham-media-image-202610111606: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111111: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111031: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610111025: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610111018: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111618: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111557: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110606: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110608: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110650: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110711: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110752: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110900: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110958: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110919: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111209: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111048: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111130: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111106: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111142: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111117: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110834: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110940: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110630: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110813: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110733: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111536: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111021: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111527: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110732: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111501: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111037: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110610: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111446: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110604: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110602: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111056: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111052: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110712: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111201: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111136: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111034: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110754: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111029: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110611: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-11-10 19:48 UTC — 🤖 مدرّب CPU على GitHub: 1,020 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 1,020 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.937
```
### 2026-11-10 18:13 UTC — 🧠 تقرير جلسة شام — المسار الرئيسي (CPU ⚠ لم يُعثر على GPU — الجلسة أبطأ بنحو 25 
```
🧠 تقرير جلسة شام — المسار الرئيسي (CPU ⚠ لم يُعثر على GPU — الجلسة أبطأ بنحو 25 ضعفاً)
خطوات تدريب حقيقية هذه الجلسة: 129 (الخطوة النهائية: 61,684)
متوسط الخسارة أول 10 خطوات: 5.1045
متوسط الخسارة آخر 10 خطوات: 3.9450
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 3.267 → بعد 2.500 (-0.767)
🛡 الحارس: نهاية الجلسة هي الأفضل أو ضمن الهامش (أفضل 2.505) — لا استعادة.
خسارة التدريب في آخر 50 خطوة: 4.068
نُشر إلى: jonsnowjonsnow/sham-checkpoint
```
### 2026-11-10 15:55 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-merged-checkpoint (يكمل من ناتجه السابق) (خطوة 61,555)
قبل: text=4.590, chat=2.028, media=7.244
بعد: text=4.624, chat=2.005, media=7.246
⏭ sham-multimodal-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 9fae7074)
⏭ sham-chat-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 8b07800f)
⏭ sham-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 6a1aad82)
📏 sham-cpu-track-checkpoint-v2 (خطوة 62,645) وحده على الميزان: text=4.327, chat=3.441, media=10.894 | الأساس: text=4.590, chat=2.028, media=7.244
📏 sham-research-track-checkpoint-v2 (خطوة 62,469) وحده على الميزان: text=4.553, chat=3.641, media=9.068 | الأساس: text=4.590, chat=2.028, media=7.244
📏 sham-crawl-checkpoint (خطوة 62,772) وحده على الميزان: text=4.974, chat=2.008, media=7.427 | الأساس: text=4.590, chat=2.028, media=7.244
قبل الدمج: text=4.590, chat=2.028, media=7.244
❌ sham-cpu-track-checkpoint-v2 (خطوة 62,645): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.01): text 4.590→4.582 (-0.2%), chat 2.028→2.031 (+0.2%), media 7.244→7.253 (+0.1%)
❌ sham-research-track-checkpoint-v2 (خطوة 62,469): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.01): text 4.590→4.584 (-0.1%), chat 2.028→2.032 (+0.2%), media 7.244→7.253 (+0.1%)
✅ sham-crawl-checkpoint (خطوة 62,772): دُمج بنسبة 0.15 — text=4.624, chat=2.005, media=7.246
⏭ sham-crawl-agent: النقطة نفسها جُرّبت سابقاً (البصمة ba84359a)
📏 sham-crawl-gh (خطوة 62,747) وحده على الميزان: text=4.204, chat=4.101, media=9.449 | الأساس: text=4.590, chat=2.028, media=7.244
⏭ sham-crawl-lightning: النقطة نفسها جُرّبت سابقاً (البصمة 180d5ec9)
⏭ sham-crawl-xlive: النقطة نفسها جُرّبت سابقاً (البصمة ef90815f)
⏭ sham-chat-arabic-sft-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 5f22d4c2)
⏭ sham-cpu-track-checkpoint: لا توجد نقطة حف
```
### 2026-11-10 15:17 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 265 (الخطوة النهائية: 62,910)
متوسط الخسارة أول 10 خطوات: 4.1082
متوسط الخسارة آخر 10 خطوات: 4.3718
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 3.388 → بعد 3.262 (-0.126)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (3.515) فاستُعيدت أفضل أوزان وُجدت (بعد 100 دفعة، 3.262) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 4.149
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-11-10 12:23 UTC — 🕸 الزاحف العام (GitHub): 63,200 وثيقة، 79.6 مليون حرف في 5.2 ساعة | crossref:406
```
🕸 الزاحف العام (GitHub): 63,200 وثيقة، 79.6 مليون حرف في 5.2 ساعة | crossref:40635 hackernews:21530 arxiv:547 github:297 ia_books:108 stackexchange:43 gutenberg:40 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-11-10 07:40 UTC — 🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
```
🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
عدد الدورات: 47
مستندات جديدة مقبولة: 86
مستبعد (مكرر/شبه مكرر: 228، أسرار وكلمات مرور: 0)
خطوات تدريب حقيقية هذه الجلسة: 127 (الخطوة النهائية: 62,469)
آخر خسارة مسجّلة: 3.9615
نُشر إلى: jonsnowjonsnow/sham-research-track-checkpoint-v2
```
