# حالة مشروع شام — 2026-10-05 14:49 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ❌ دفتر أساسي فشل: المسار A 1 (cpu_training_track) — Traceback (most recent call last):     raise DeadKernelError("Kernel died") nbclient.exceptions.DeadKernelError: Kernel died
- ❌ دفتر أساسي فشل: المرحلة الأولى 2 (text_stage1) — (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: error
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete — تقدم: {'samples_consumed': 1541, 'step': 46, 'last_run_sources': {'x': 62, 'web_fallback': 16}}
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: complete — تقدم: {'samples_consumed': 2370, 'step': 130, 'last_run_sources': {'x': 117}}
- ✅ مسار جمع وترميز الفيديو — دفتر: complete — تقدم: {'videos_consumed': 568}
- ✅ المرحلة الثانية — دمج الصورة والصوت مع النص (GPU) — دفتر: complete
- ✅ المسار A — التدريب النصي المستمر (CPU) — دفتر: error
- ✅ المسار B — البحث الذاتي من الإنترنت (CPU) — دفتر: complete
- ✅ المرحلة الثالثة — التجميع والمحادثة (كل الوسائط + البحث + الدمج) — دفتر: complete

**الخطوة التالية المقترحة:** شام متعدد الوسائط جاهز (نص + صورة + صوت). — الخطوة التالية: تشغيل خادم شام (serve.py) على النقطة final_multimodal.pt وربطه بالموقع/البوت. أخبري Claude: «لنكمل شام».

## الدفاتر على Kaggle (بأسماء مستعارة)
- complete | المدرّب الحي 1 | الدور: primary | آخر تشغيل 2026-10-03 | GPU
- complete | المرحلة الثالثة 2 | الدور: duplicate | آخر تشغيل 2026-09-30
- complete | المرحلة الثالثة 5 | الدور: primary | آخر تشغيل 2026-10-02
- complete | المرحلة الثالثة 4 | الدور: duplicate | آخر تشغيل 2026-10-01
- complete | المرحلة الثالثة 3 | الدور: duplicate | آخر تشغيل 2026-09-30 | GPU
- complete | مركز تحكم شام 1 | الدور: tool | آخر تشغيل 2026-09-24
- cancelAcknowledged | مسار ترميز الصورة 2 | الدور: duplicate | آخر تشغيل 2026-09-28
- error | مسار ترميز الصوت 2 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ: ---> 58             raise ConnectionError(      60         except HTTPError as e: ConnectionError: Connection error trying to communicate with service.
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- complete | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-03
- complete | المرحلة الثانية 2 | الدور: primary | آخر تشغيل 2026-10-03
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- complete | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-04
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-04 | GPU
- complete | المسار B 1 | الدور: primary | آخر تشغيل 2026-10-04
- error | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-04 | الخطأ: Traceback (most recent call last):     raise DeadKernelError("Kernel died") nbclient.exceptions.DeadKernelError: Kernel died
- error | المرحلة الأولى 2 | الدور: primary | آخر تشغيل 2026-10-04 | GPU | الخطأ: (بلا رسالة فشل من Kaggle) الحالة الخام: <notebook> has status "KernelWorkerStatus.ERROR"
- complete | المرحلة الثانية 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22
- (+4 دفتراً غير تابع لشام، +2 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-10-05T14:49 in_progress ، 2026-10-05T06:52 success ، 2026-10-05T05:48 success
- Sham Collector (free CPU runner): 2026-10-05T14:30 in_progress ، 2026-10-05T05:33 success
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-10-05T14:24 in_progress ، 2026-10-05T05:24 success
- Sham CI (contract + self-tests, read-only): 2026-10-05T09:51 success ، 2026-10-05T08:50 success ، 2026-10-05T07:11 success ، 2026-10-05T06:52 success
- Sham Merge + Repair + Eval (free CPU runner): 2026-10-05T06:09 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 2776586859 | 2026-10-04 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 144053496 | 2026-10-05 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 34984143 | 2026-10-05 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 768362 | 2026-10-01 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-multimodal-checkpoint | 577676682 | 2026-10-03 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 580621375 | 2026-10-03 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 2731054018 | 2026-10-04 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 385291604 | 2026-10-05 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 582297996 | 2026-10-03 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 16620339 | 2026-10-03 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 581139610 | 2026-10-05 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 1520107 | 2026-10-05 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-gh-collect-corpus | 39923781 | 2026-10-04 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-merged-checkpoint | 579844679 | 2026-10-05 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 356 | 2026-10-05 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | 277 | 2026-09-27 | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-10-05 02:11 UTC — 🤖 مدرّب CPU على GitHub: 1,714 خطوة | نُشر: None | نصوص: jonsnowjonsnow/sham-craw
```
🤖 مدرّب CPU على GitHub: 1,714 خطوة | نُشر: None | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.738
```
