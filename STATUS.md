# حالة مشروع شام — 2026-10-29 01:01 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ❌ دفتر أساسي فشل: مسار ترميز الصوت 3 (audio_tokenizer) — (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- ❌ سير العمل «Sham v2 live capability smoke test» فشل في آخر تشغيلين

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: complete
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: error — تقدم: {'samples_consumed': 12736, 'step': 45959, 'last_run_sources': {'cv17-ar': 1000}, 'codebook_usage': 2005, 'recon': 0.012837395138506378}
- ✅ مسار جمع وترميز الفيديو — دفتر: complete — تقدم: {'videos_consumed': 3767}
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
- error | المرحلة الثالثة 5 | الدور: duplicate | آخر تشغيل 2026-10-27
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-10-28
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-10-28
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- complete | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-10-28
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: primary | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +4 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-10-29T01:00 in_progress
- Sham CI (contract + self-tests, read-only): 2026-10-29T00:52 success ، 2026-10-29T00:52 cancelled ، 2026-10-29T00:52 cancelled ، 2026-10-29T00:51 cancelled
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-10-29T00:14 success
- Sham Token Shards (free CPU runner): 2026-10-28T22:54 success
- Sham Kaggle Inspect (read-only): 2026-10-28T22:49 success
- Sham v2 live capability smoke test: 2026-10-28T22:44 failure ، 2026-10-28T22:04 failure ، 2026-10-28T21:36 skipped ، 2026-10-28T21:30 skipped
- Sham Collector (free CPU runner): 2026-10-28T22:31 in_progress
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-10-28T22:29 in_progress
- Sham Merge + Repair + Eval (free CPU runner): 2026-10-28T21:54 success
- Sham v2 media weights (ready picture model + Arabic voice into Sham's own model repo): 2026-10-28T21:30 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- 2026-10-28T22:44 «Sham v2 live capability smoke test» — الخطوة: capability ← Test a real capability question through Sham v2's dedicated Studio — https://github.com/jonsnow-org/Ttbik/actions/runs/40782309652
- 2026-10-28T22:04 «Sham v2 live capability smoke test» — الخطوة: capability ← Test a real capability question through Sham v2's dedicated Studio — https://github.com/jonsnow-org/Ttbik/actions/runs/40777133169

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 2422500279 | 2026-10-27 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 144848618 | 2026-10-28 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35628317 | 2026-10-28 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 15245465 | 2026-10-28 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-multimodal-checkpoint | 581366608 | 2026-10-28 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 580511123 | 2026-10-28 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 0 | 2026-10-28 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 0 | 2026-10-29 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 794499784 | 2026-10-28 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 661655 | 2026-10-28 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 791678992 | 2026-10-28 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 582509 | 2026-10-28 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-gh-collect-corpus | 666042000 | 2026-10-29 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-merged-checkpoint | 718599013 | 2026-10-28 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 14210 | 2026-10-29 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | 277 | 2026-09-27 | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 730 | 2026-10-29 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 541160011 | 2026-10-29 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
| sham-crawl-modal | — | غير موجودة | modal_gpu | نموذج جلسات GPU على Modal (مرشّح لبوابة الدمج) |
| sham-grown-checkpoint | 718122048 | 2026-10-11 | model_grow | أفضل نقطة حفظ بالقياس بعد التكبير (طبقات أكثر وسياق أطول، الدالة محفوظة) — يفضّلها الدمج والمدرّب الحي عند التعادل |
| sham-image-tokenizer-v2-checkpoint | 144015040 | 2026-10-15 | lightning_probe | مُرمِّز الصورة v2 (128 بكسل، 64 رمزاً، يُدرَّب على CPU في استوديو Lightning) |
| sham-audio-tokenizer-v2-checkpoint | 34972869 | 2026-10-15 | lightning_probe | مُرمِّز الصوت v2 (كل مقاطع كل مقطع، يُدرَّب على CPU في استوديو Lightning) |
| sham-chat-arabic-sft-checkpoint | 579344243 | 2026-10-27 | arabic_sft | نقطة دفتر SFT العربي المنفصل (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-repair-remerge-checkpoint | 0 | 2026-10-28 | repair_remerge | ناتج أداة الاسترجاع والإصلاح وإعادة الدمج (تدخل الدمج كمصدر عادي عبر قاعدة sham*) |
| sham-runtime-creds | 493 | 2026-10-16 | any | مجموعة خاصة بملف اعتماد كاكل للنسخ المدفوعة بالواجهة (أسرار — لا تُرفق إلا بدفاتر خاصة؛ لا أوزان فيها) |
| sham-media-refined | 144023228 | 2026-10-18 | decoder_refine | مفكّ الصورة والصوت المصقول وحده (الترميز والقاموس كما هما بالضبط) — يُعتمد في الاستوديو فقط إذا طابق ترميز النموذج المدموج |
| sham-crawl-lightning | 791545617 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-lightning-corpus | 528314 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-image-202610111606 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111201 | 129398149 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111111 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111031 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111025 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111018 | 1060576070 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-image-202610111618 | 129662473 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111557 | 129561512 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110940 | 393669296 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110630 | 374725918 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110919 | 394928871 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110711 | 379620779 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110752 | 398679047 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110813 | 404805261 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110733 | 134444553 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110712 | 134810216 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111501 | 129810937 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111446 | 129385094 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111130 | 129692253 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110958 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111453 | 129736346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111547 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110732 | 378321201 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110606 | 377530614 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111510 | 129788524 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111154 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110608 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110605 | 148376346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110604 | 377708247 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111048 | 128940003 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111056 | 128764385 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111215 | 128791138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110650 | 379823987 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111142 | 128936589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111002 | 135942947 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110652 | 133484773 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111041 | 127975318 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110610 | 377640881 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111536 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110754 | 136288905 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110602 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111117 | 128929395 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110815 | 135504427 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110834 | 402363586 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111037 | 129250366 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110900 | 134992165 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111519 | 128976330 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111034 | 128313062 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111029 | 127678650 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110611 | 136582608 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111527 | 129560681 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111209 | 129393589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111148 | 128708430 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111136 | 129026168 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111123 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111106 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111100 | 129039677 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111052 | 128920140 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111044 | 129023022 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111021 | 131035980 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110941 | 136392138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110921 | 136080898 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110836 | 136602207 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110631 | 134794961 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |

## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)
- sham-media-image-202610111606: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111201: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111111: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111031: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610111025: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610111018: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111618: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111557: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110940: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110630: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110919: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110711: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110752: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110813: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110733: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110712: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111501: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111446: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111130: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110958: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111453: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111547: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110732: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-audio-202610110606: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111510: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111154: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110608: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110605: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110604: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111048: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111056: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111215: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110650: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111142: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111002: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110652: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111041: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110610: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111536: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110754: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110602: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111117: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110815: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110834: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111037: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110900: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111519: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111034: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111029: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110611: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111527: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111209: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111148: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111136: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111123: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111106: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111100: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111052: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111044: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111021: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110941: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110921: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110836: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110631: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-10-29 01:01 UTC — 🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
```
🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
عدد الدورات: 41
مستندات جديدة مقبولة: 71
مستبعد (مكرر/شبه مكرر: 153، أسرار وكلمات مرور: 0)
خطوات تدريب حقيقية هذه الجلسة: 102 (الخطوة النهائية: 66,888)
آخر خسارة مسجّلة: 3.7575
نُشر إلى: jonsnowjonsnow/sham-research-track-checkpoint-v2
```
### 2026-10-28 23:20 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-merged-checkpoint (يكمل من ناتجه السابق) (خطوة 61,555)
قبل: text=4.591, chat=2.035, media=7.441
بعد: text=4.591, chat=2.031, media=7.420
⏭ sham-multimodal-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة d7192890)
⏭ sham-chat-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 041a6bc2)
⏭ sham-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 028ef734)
⏭ sham-cpu-track-checkpoint-v2: النقطة نفسها جُرّبت سابقاً (البصمة c381c7b4)
⏭ sham-research-track-checkpoint-v2: النقطة نفسها جُرّبت سابقاً (البصمة cb7668c9)
📏 sham-crawl-checkpoint (خطوة 61,835) وحده على الميزان: text=4.612, chat=2.053, media=7.439 | الأساس: text=4.591, chat=2.035, media=7.441
⏭ sham-crawl-agent: النقطة نفسها جُرّبت سابقاً (البصمة ba84359a)
⏭ sham-crawl-gh: النقطة نفسها جُرّبت سابقاً (البصمة 1db4eb7e)
⏭ sham-crawl-lightning: النقطة نفسها جُرّبت سابقاً (البصمة 180d5ec9)
⏭ sham-crawl-xlive: النقطة نفسها جُرّبت سابقاً (البصمة ef90815f)
⏭ sham-chat-arabic-sft-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 5f22d4c2)
⏭ sham-cpu-track-checkpoint: لا توجد نقطة حفظ
⏭ sham-grown-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 08300e9a)
⏭ sham-repair-remerge-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة c9166018)
قبل الدمج: text=4.591, chat=2.035, media=7.441
✅ sham-crawl-checkpoint (خطوة 61,835): دُمج بنسبة 0.30 — text=4.591, chat=2.031, media=7.420
🔬 مسبار التفكير المتسلسل (712 خطوة، 45.8 د): خسارة الحلول 4.44→0.48 | نص 4.50→7.11 | إصابة 0%→38% ⇒ قرار تلقائي: حصة التفكير المتسلسل 0%
  image: لا مُرمِّز في الحساب أفضل بما يكفي من مُرمِّز الرأس (None مقابل None) — يبقى
  audio: لا مُرمِّز في الحساب أفضل بما يكفي من مُرمِّز الرأس (0.010826251469552517 مقابل 0.012910488992929459) — يبقى
نُشر إلى jonsnowjonsnow/sham-merged-checkpoint
(77 دقيقة)
```
### 2026-10-28 22:56 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 245 (الخطوة النهائية: 67,031)
متوسط الخسارة أول 10 خطوات: 3.4894
متوسط الخسارة آخر 10 خطوات: 3.5589
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.840 → بعد 2.756 (-0.084)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (2.973) فاستُعيدت أفضل أوزان وُجدت (بعد 100 دفعة، 2.756) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 3.769
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-10-28 19:23 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-merged-checkpoint (يكمل من ناتجه السابق) (خطوة 61,555)
قبل: text=4.591, chat=2.035, media=7.441
بعد: text=4.591, chat=2.035, media=7.441
⏭ sham-multimodal-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة d7192890)
📏 sham-chat-checkpoint (خطوة 79,785) وحده على الميزان: text=4.934, chat=3.652, media=8.523 | الأساس: text=4.591, chat=2.035, media=7.441
⏭ sham-checkpoint: النقطة نفسها جُرّبت سابقاً (البصمة 028ef734)
📏 sham-cpu-track-checkpoint-v2 (خطوة 66,786) وحده على الميزان: text=4.159, chat=4.090, media=9.533 | الأساس: text=4.591, chat=2.035, media=7.441
📏 sham-research-track-checkpoint-v2 (خطوة 61,662) وحده على الميزان: text=5.064, chat=2.806, media=7.790 | الأساس: text=4.591, chat=2.035, media=7.441
قبل الدمج: text=4.591, chat=2.035, media=7.441
❌ sham-chat-checkpoint (خطوة 79,785): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.05): text 4.591→4.594 (+0.1%), chat 2.035→2.106 (+3.5%), media 7.441→7.464 (+0.3%)
❌ sham-cpu-track-checkpoint-v2 (خطوة 66,786): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.05): text 4.591→4.543 (-1.1%), chat 2.035→2.127 (+4.5%), media 7.441→7.523 (+1.1%)
❌ sham-research-track-checkpoint-v2 (خطوة 61,662): لم يُدمج (لم يحسّن كل المهارات معاً) — أقرب محاولة (نسبة 0.05): text 4.591→4.595 (+0.1%), chat 2.035→2.042 (+0.3%), media 7.441→7.468 (+0.4%)
📏 sham-crawl-checkpoint (خطوة 62,858) وحده على الميزان: text=4.257, chat=3.852, media=9.294 | الأساس: text=4.591, chat=2.035, media=7.441
⏭ sham-crawl-agent: النقطة نفسها جُرّبت سابقاً (البصمة ba84359a)
📏 sham-crawl-gh (خطوة 62,673) وحده على الميزان: text=4.161, chat=3.810, media=9.407 | الأساس: text=4.591, chat=2.035, media=7.441
⏭ sham-crawl-lightning: النقطة نفسها جُرّبت سابقاً (البصمة 180d5ec9)
⏭ sham-crawl-xlive: النقطة نفسها جُ
```
### 2026-10-28 17:59 UTC — 🕸 الزاحف العام (GitHub): 83,612 وثيقة، 108.6 مليون حرف في 5.2 ساعة | crossref:52
```
🕸 الزاحف العام (GitHub): 83,612 وثيقة، 108.6 مليون حرف في 5.2 ساعة | crossref:52244 hackernews:29171 github:1045 arxiv:579 gutenberg:282 ia_books:196 stackexchange:93 europepmc:2 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-10-28 17:41 UTC — 🤖 مدرّب CPU على GitHub: 1,118 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 1,118 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.819
```
