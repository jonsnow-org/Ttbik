# حالة مشروع شام — 2026-10-16 04:38 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ❌ دفتر أساسي فشل: مسار ترميز الصوت 3 (audio_tokenizer) — (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- ⚠ sham-checkpoint لم تُحدَّث منذ 5 أيام

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: complete
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: error — تقدم: {'samples_consumed': 39956, 'step': 4938, 'last_run_sources': {'cv17-ar': 1000}, 'codebook_usage': 1985, 'recon': 0.019079974774892133}
- ✅ مسار جمع وترميز الفيديو — دفتر: complete — تقدم: {'videos_consumed': 967}
- ✅ المرحلة الثانية — دمج الصورة والصوت مع النص (GPU) — دفتر: complete
- ✅ المسار A — التدريب النصي المستمر (CPU) — دفتر: complete
- ✅ المسار B — البحث الذاتي من الإنترنت (CPU) — دفتر: missing
- ✅ المرحلة الثالثة — التجميع والمحادثة (كل الوسائط + البحث + الدمج) — دفتر: running

**الخطوة التالية المقترحة:** شام متعدد الوسائط جاهز (نص + صورة + صوت). — الخطوة التالية: تشغيل خادم شام (serve.py) على النقطة final_multimodal.pt وربطه بالموقع/البوت. أخبري Claude: «لنكمل شام».

## الدفاتر على Kaggle (بأسماء مستعارة)
- complete | المدرّب الحي 1 | الدور: primary | آخر تشغيل 2026-10-10 | GPU
- complete | المرحلة الثالثة 4 | الدور: duplicate | آخر تشغيل 2026-10-02
- complete | المرحلة الثالثة 3 | الدور: duplicate | آخر تشغيل 2026-10-01
- complete | المرحلة الثالثة 2 | الدور: duplicate | آخر تشغيل 2026-09-30 | GPU
- complete | مركز تحكم شام 1 | الدور: tool | آخر تشغيل 2026-09-24
- cancelAcknowledged | مسار ترميز الصورة 2 | الدور: duplicate | آخر تشغيل 2026-09-28
- error | مسار ترميز الصوت 2 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ: ---> 58             raise ConnectionError(      60         except HTTPError as e: ConnectionError: Connection error trying to communicate with service. قبل الفشل: 0.00s - to python to disable frozen m
- running | المرحلة الثالثة 5 | الدور: primary | آخر تشغيل 2026-10-16
- running | الدفتر الشامل 1 | الدور: primary | آخر تشغيل 2026-10-15
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- running | دفتر المحادثة والمرمزات 1 | الدور: primary | آخر تشغيل 2026-10-15
- cancelAcknowledged | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-09
- cancelAcknowledged | المرحلة الثانية 2 | الدور: duplicate | آخر تشغيل 2026-10-10 | GPU
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- error | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-11 | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-12
- running | دفتر المسارين A وB 1 | الدور: primary | آخر تشغيل 2026-10-15
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-12
- complete | المرحلة الأولى 2 | الدور: primary | آخر تشغيل 2026-10-10
- complete | المرحلة الثانية 1 | الدور: primary | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+5 دفتراً غير تابع لشام، +3 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-10-16T04:37 in_progress ، 2026-10-15T21:27 success ، 2026-10-15T17:05 success
- Sham Collector (free CPU runner): 2026-10-16T04:26 in_progress ، 2026-10-15T21:19 success ، 2026-10-15T16:56 success
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-10-16T04:19 in_progress ، 2026-10-15T21:16 success ، 2026-10-15T16:50 success
- Sham Lightning Studio (free CPU): 2026-10-16T03:38 success ، 2026-10-15T22:56 success ، 2026-10-15T16:31 success
- Sham Repair + Re-merge (push the separate notebook to Kaggle): 2026-10-16T02:23 success
- Sham Merge + Repair + Eval (free CPU runner): 2026-10-16T01:43 success ، 2026-10-15T20:33 failure ، 2026-10-15T15:47 success
- Sham Restarter (keeps the Kaggle notebooks in a continuous cycle): 2026-10-16T01:32 success ، 2026-10-16T01:29 success ، 2026-10-15T23:14 success ، 2026-10-15T20:29 success
- Sham Arabic SFT (push the separate notebook to Kaggle): 2026-10-16T01:26 success ، 2026-10-15T12:15 success
- Sham Token Shards (free CPU runner): 2026-10-15T21:50 failure ، 2026-10-15T17:24 success ، 2026-10-15T12:10 success
- Sham ModelScope Studio (host + worker): 2026-10-15T21:31 failure ، 2026-10-15T15:06 success ، 2026-10-15T12:40 success
- Sham Vault (checkpoint backup to ModelScope): 2026-10-15T19:21 success
- Sham CI (contract + self-tests, read-only): 2026-10-15T16:21 success ، 2026-10-15T16:15 success ، 2026-10-15T16:14 cancelled ، 2026-10-15T16:14 cancelled
- Sham Kaggle Runs (read-only): 2026-10-15T13:19 success ، 2026-10-15T12:18 success
- Sham Studio Ask (read-only): 2026-10-15T13:10 success ، 2026-10-15T12:53 success ، 2026-10-15T12:45 success ، 2026-10-15T11:39 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- 2026-10-15T21:50 «Sham Token Shards (free CPU runner)» — الخطوة: غير معروفة — https://github.com/jonsnow-org/Ttbik/actions/runs/38812927018
- 2026-10-15T21:31 «Sham ModelScope Studio (host + worker)» — الخطوة: sync ← Download the merged checkpoint from Kaggle — https://github.com/jonsnow-org/Ttbik/actions/runs/38810489529
- 2026-10-15T20:33 «Sham Merge + Repair + Eval (free CPU runner)» — الخطوة: غير معروفة — https://github.com/jonsnow-org/Ttbik/actions/runs/38802973334

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 0 | 2026-10-10 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 144161007 | 2026-10-15 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35137014 | 2026-10-15 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 2577361 | 2026-10-15 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-multimodal-checkpoint | 580581436 | 2026-10-15 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 580601537 | 2026-10-16 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 4233234473 | 2026-10-15 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 0 | 2026-10-15 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 0 | 2026-10-15 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 14965990 | 2026-10-15 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 791536240 | 2026-10-16 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 875922 | 2026-10-16 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-gh-collect-corpus | 77140384 | 2026-10-16 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-merged-checkpoint | 0 | 2026-10-16 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 10387 | 2026-10-16 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | 277 | 2026-09-27 | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-keeper-state | 575 | 2026-10-16 | — | حالة حارس الدفتر الشامل (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-selflearn | — | غير موجودة | selflearn | نسخة متعلّمة من تجارب أسئلة الويب (تُدمج تلقائياً عبر الإصلاح والبوابة كأي مصدر sham-crawl-*) |
| sham-crawl-selflearn-corpus | — | غير موجودة | selflearn | نصوص تجارب أسئلة الويب (تدخل خط النص ومرحلة المحادثة تلقائياً) |
| sham-text-shards | 306228498 | 2026-10-15 | token_shards | نوافذ نص جاهزة التقطيع (احتياط حين تتوقف مصادر الإنترنت في جلسة التدريب) |
| sham-crawl-modal | — | غير موجودة | modal_gpu | نموذج جلسات GPU على Modal (مرشّح لبوابة الدمج) |
| sham-grown-checkpoint | 718122048 | 2026-10-11 | model_grow | أفضل نقطة حفظ بالقياس بعد التكبير (طبقات أكثر وسياق أطول، الدالة محفوظة) — يفضّلها الدمج والمدرّب الحي عند التعادل |
| sham-image-tokenizer-v2-checkpoint | 144015040 | 2026-10-15 | lightning_probe | مُرمِّز الصورة v2 (128 بكسل، 64 رمزاً، يُدرَّب على CPU في استوديو Lightning) |
| sham-audio-tokenizer-v2-checkpoint | 34972869 | 2026-10-15 | lightning_probe | مُرمِّز الصوت v2 (كل مقاطع كل مقطع، يُدرَّب على CPU في استوديو Lightning) |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-media-image-202610111618 | 129662473 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111606 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111557 | 129561512 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111547 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111536 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111527 | 129560681 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111519 | 128976330 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111510 | 129788524 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111501 | 129810937 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111453 | 129736346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111446 | 129385094 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111215 | 128791138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111209 | 129393589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111201 | 129398149 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111154 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111148 | 128708430 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111142 | 128936589 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111136 | 129026168 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111130 | 129692253 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111123 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111117 | 128929395 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111111 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111106 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111100 | 129039677 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111056 | 128764385 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111052 | 128920140 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111048 | 128940003 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111044 | 129023022 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111041 | 127975318 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111037 | 129250366 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111034 | 128313062 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111031 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111029 | 127678650 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111025 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111021 | 131035980 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610111018 | 1060576070 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610111002 | 135942947 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110958 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110941 | 136392138 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110940 | 393669296 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110921 | 136080898 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110919 | 394928871 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110900 | 134992165 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110836 | 136602207 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110834 | 402363586 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110815 | 135504427 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110813 | 404805261 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110754 | 136288905 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110752 | 398679047 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110733 | 134444553 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110732 | 378321201 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110712 | 134810216 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110711 | 379620779 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110652 | 133484773 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110650 | 379823987 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110631 | 134794961 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110630 | 374725918 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110611 | 136582608 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110610 | 377640881 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110608 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110606 | 377530614 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110605 | 148376346 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-audio-202610110604 | 377708247 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-media-image-202610110602 | 0 | 2026-10-11 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-lightning | 791545617 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-runtime-creds | 232 | 2026-10-15 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |
| sham-crawl-lightning-corpus | 528314 | 2026-10-15 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-chat-arabic-sft-checkpoint | 580325099 | 2026-10-15 | يُصنَّف تلقائياً | (تُدمج بحسب نوع ملفاتها) |

## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)
- sham-media-image-202610111618: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111606: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111557: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111547: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111536: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111527: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111519: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111510: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111501: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111453: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111446: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111215: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111209: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111201: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111154: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111148: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111142: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111136: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111130: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111123: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111117: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111111: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111106: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111100: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111056: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111052: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111048: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111044: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111041: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111037: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610111034: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111031: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111029: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111025: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111021: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610111018: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610111002: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110958: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110941: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110940: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110921: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110919: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110900: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-image-202610110836: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110834: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110815: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110813: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110754: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110752: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110733: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110732: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110712: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110711: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110652: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110650: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110631: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110630: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110611: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110610: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110608: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110606: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110605: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-media-audio-202610110604: 200 ملف (audio 200) — مثال: audio/000000.wav | audio/000001.wav | audio/000002.wav
- sham-media-image-202610110602: 200 ملف (image 200) — مثال: images/000000.jpg | images/000001.jpg | images/000002.jpg
- sham-runtime-creds: 1 ملف (text 1) — مثال: kaggle.json
- sham-chat-arabic-sft-checkpoint: 6 ملف (model 3، text 3) — مثال: audio_tokenizer.pt | final_chat.pt | image_tokenizer.pt

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-10-16 04:45 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 191 (الخطوة النهائية: 61,746)
متوسط الخسارة أول 10 خطوات: 4.6872
متوسط الخسارة آخر 10 خطوات: 3.5102
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 1.984 → بعد 1.778 (-0.206)
🛡 الحارس: نهاية الجلسة كانت أسوأ على النص غير المرئي (1.800) فاستُعيدت أفضل أوزان وُجدت (بعد 400 دفعة، 1.778) ولم تُنشر الأوزان الأسوأ.
خسارة التدريب في آخر 50 خطوة: 4.004
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-10-16 04:39 UTC — 📏 المقياس الثابت — مرحلة التجميع والمحادثة — الخطوة 63,867
```
📏 المقياس الثابت — مرحلة التجميع والمحادثة — الخطوة 63,867
خسارة الإجابة (أقل أفضل): 3.416 (-0.045) على 120 سؤالاً لم يُدرَّب عليها
تكرار الكلمة نفسها (أقل أفضل): 0.00 (+0.00)
تنوّع العبارات (أعلى أفضل): 1.00 (+0.22)
👤 ما هي عاصمة سوريا؟
🤖 عاصمة سوريا هي عمان.
👤 اكتب جملة عن فوائد القراءة.
🤖 الاستكشاف: القراءة هو "منذ الحدود".
👤 من أنت؟
🤖 سيدنا عمر
🧬 التطوير الذاتي هذه الجلسة:
  • الإصلاح قبل الدمج: final_multimodal.pt (خطوة 63,882): ✅ سليم — لم يحتج إصلاحاً
  • الإصلاح قبل الدمج: step_61841.pt (خطوة 61,841): ✅ سليم — لم يحتج إصلاحاً
  • الإصلاح قبل الدمج: step_61853.pt (خطوة 61,853): 81 مصفوفة غير معروفة حُذفت — ✅ أُصلح وأصبح صالحاً لبوابة الدمج
  • الإصلاح قبل الدمج: final.pt (خطوة 61,859): ✅ سليم — لم يحتج إصلاحاً
  • الإصلاح قبل الدمج: final.pt (خطوة 66,129): 81 مصفوفة غير معروفة حُذفت — ✅ أُصلح وأصبح صالحاً لبوابة الدمج
  • الإصلاح قبل الدمج: final.pt (خطوة 42,893): أداة تقسيم نص مختلفة: 6,003 صف مشترك نُقل كما هو، و25,997 صف بُني من متوسط قطع المصدر (تقرّر البوابة بعدها هل النتيجة صالحة) — ✅ أُصلح وأصبح صالحاً لبوابة الدمج
  • الإصلاح قبل الدمج: final.pt (خطوة 62,649): 81 مصفوفة غير معروفة حُذفت — ✅ أُصلح وأصبح صالحاً لبوابة الدمج
  • الإصلاح قبل الدمج: final.pt (خطوة 62,201): 81 مصفوفة غير معروفة حُذفت — ✅ أُصلح وأصبح صالحاً لبوابة الدمج
  • الإصلاح قبل الدمج: final.pt (خطوة 51,425): أداة تقسيم نص مختلفة: 6,003 صف مشترك نُقل كما هو، و25,997 صف بُني من متوسط قطع المصدر (تقرّر البوابة بعدها هل النتيجة صالحة) — ✅ أُصلح وأصبح صالحاً لبوابة الدمج
  • الإصلاح قبل الدمج: final_chat.pt (خطوة 63,620): ✅ سليم — لم يحتج إصلاحاً
  • الإصلاح قبل الدمج: final_chat.pt (خطوة 63,244): ✅ سليم — لم يحتج إصلاحاً
  • الإصلاح قبل الدمج: final_grown.pt (خطوة 61,555): 81 مصفوفة غير معروفة حُذفت — ✅ أُصلح وأصبح صالحاً لبوابة الدمج
  • الإصلاح قبل الدمج: final_merged.pt (خطوة 61,555): 81 
```
### 2026-10-16 03:19 UTC — 🕸 الزاحف العام (GitHub): 100,242 وثيقة، 147.4 مليون حرف في 5.2 ساعة | crossref:5
```
🕸 الزاحف العام (GitHub): 100,242 وثيقة، 147.4 مليون حرف في 5.2 ساعة | crossref:54091 hackernews:39312 gutenberg:4425 github:1040 arxiv:931 ia_books:234 stackexchange:209 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-10-16 03:08 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-merged-checkpoint (يكمل من ناتجه السابق) (خطوة 61,555)
قبل: text=4.012, chat=3.838, media=4.775
بعد: text=4.025, chat=3.746, media=4.760
⏭ sham-multimodal-checkpoint: الخطوة 63,882 جُرّبت سابقاً
⏭ sham-checkpoint: الخطوة 61,841 جُرّبت سابقاً
⏭ sham-cpu-track-checkpoint-v2: الخطوة 61,853 جُرّبت سابقاً
⏭ sham-research-track-checkpoint-v2: ❌ لا توجد معه أداة تقسيم نص لمعرفة معنى صفوفه
⏭ sham-crawl-checkpoint: الخطوة 66,129 جُرّبت سابقاً
⏭ sham-crawl-agent: الخطوة 42,893 جُرّبت سابقاً
⏭ sham-crawl-gh: الخطوة 62,096 جُرّبت سابقاً
⏭ sham-crawl-lightning: الخطوة 62,201 جُرّبت سابقاً
⏭ sham-crawl-xlive: الخطوة 51,425 جُرّبت سابقاً
⏭ sham-cpu-track-checkpoint: لا توجد نقطة حفظ
⏭ sham-grown-checkpoint: الخطوة 61,555 جُرّبت سابقاً
⏭ sham-keeper-state: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110604: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110606: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110610: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110630: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110650: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110711: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110732: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110752: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110813: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110834: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110919: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110940: لا توجد نقطة حفظ
⏭ sham-media-audio-202610110958: لا توجد نقطة حفظ
⏭ sham-media-audio-202610111018: لا توجد نقطة حفظ
⏭ sham-media-audio-202610111025: لا توجد نقطة حفظ
⏭ sham-media-audio-202610111031: لا توجد نقطة حفظ
⏭ sham-media-image-202610110602: لا توجد نقطة حفظ
⏭ sham-media-image-202610110605: لا توجد نقطة حفظ
⏭ sham-media-image-202610110608: لا توجد نقطة حفظ
⏭ sham-media-image-202610110611: لا
```
### 2026-10-16 02:53 UTC — 🤖 مدرّب CPU على GitHub: 1,254 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 1,254 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.885
```
### 2026-10-15 22:34 UTC — 🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
```
🧠 تقرير جلسة شام — البحث الذاتي المستمر (Track B)
عدد الدورات: 283
مستندات جديدة مقبولة: 18
مستبعد (مكرر/شبه مكرر: 407، أسرار وكلمات مرور: 0)
خطوات تدريب حقيقية هذه الجلسة: 18 (الخطوة النهائية: 61,859)
آخر خسارة مسجّلة: 4.2915
نُشر إلى: jonsnowjonsnow/sham-research-track-checkpoint-v2
```
