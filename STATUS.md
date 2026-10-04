# حالة مشروع شام — 2026-10-04 21:33 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- ⚠ لا تشغيلات مسجلة لسير العمل «Sham Merge + Repair + Eval (free CPU runner)» (لم يبدأ بعد؟)
- ❓ مجموعة sham-audio-tokenizer-adult-synth في حسابك ليست في العقد (منسية؟ أم جديدة تحتاج وصفاً في CONTRACT.json)
- ❓ مجموعة sham-video-frames-audio-tokenizers في حسابك ليست في العقد (منسية؟ أم جديدة تحتاج وصفاً في CONTRACT.json)
- ❓ مجموعة sham-audio-tokenizer-adult-synth-v2 في حسابك ليست في العقد (منسية؟ أم جديدة تحتاج وصفاً في CONTRACT.json)
- ❓ مجموعة sham-orchestrator-state في حسابك ليست في العقد (منسية؟ أم جديدة تحتاج وصفاً في CONTRACT.json)
- ℹ لا تقارير بعد في sham-reports (تظهر بعد أول جلسة تعمل بالكود الجديد)

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: complete
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete — تقدم: {'samples_consumed': 1463, 'step': 42, 'last_run_sources': {'x': 76, 'web_fallback': 24}}
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: complete — تقدم: {'samples_consumed': 2253, 'step': 112, 'last_run_sources': {'x': 69}}
- ✅ مسار جمع وترميز الفيديو — دفتر: complete — تقدم: {'videos_consumed': 568}
- ✅ المرحلة الثانية — دمج الصورة والصوت مع النص (GPU) — دفتر: complete
- ✅ المسار A — التدريب النصي المستمر (CPU) — دفتر: complete
- ✅ المسار B — البحث الذاتي من الإنترنت (CPU) — دفتر: complete
- ✅ المرحلة الثالثة — التجميع والمحادثة (كل الوسائط + البحث + الدمج) — دفتر: complete

**الخطوة التالية المقترحة:** شام متعدد الوسائط جاهز (نص + صورة + صوت). — الخطوة التالية: تشغيل خادم شام (serve.py) على النقطة final_multimodal.pt وربطه بالموقع/البوت. أخبري Claude: «لنكمل شام».

## الدفاتر على Kaggle (بأسماء مستعارة)
- complete | المدرّب الحي 1 | الدور: primary | آخر تشغيل 2026-10-03 | GPU
- complete | المرحلة الثالثة 5 | الدور: primary | آخر تشغيل 2026-10-02
- complete | المرحلة الثالثة 2 | الدور: duplicate | آخر تشغيل 2026-09-30
- complete | المرحلة الثالثة 4 | الدور: duplicate | آخر تشغيل 2026-10-01
- complete | المرحلة الثالثة 3 | الدور: duplicate | آخر تشغيل 2026-09-30 | GPU
- complete | مركز تحكم شام 1 | الدور: tool | آخر تشغيل 2026-09-24
- cancelAcknowledged | مسار ترميز الصورة 2 | الدور: duplicate | آخر تشغيل 2026-09-28
- error | مسار ترميز الصوت 2 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ: ---> 58             raise ConnectionError(      60         except HTTPError as e: ConnectionError: Connection error trying to communicate with service.
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- complete | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-03
- complete | المرحلة الثانية 2 | الدور: primary | آخر تشغيل 2026-10-03
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- complete | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-03
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-03 | GPU
- complete | المسار B 1 | الدور: primary | آخر تشغيل 2026-10-03
- complete | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-03
- complete | المرحلة الأولى 2 | الدور: primary | آخر تشغيل 2026-10-04 | GPU
- complete | المرحلة الثانية 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ:     494     except FileNotFoundError: --> 495         raise EmptyDatasetError(f"The directory at {base_path} doesn't contain any data files") from None EmptyDatasetError: The directory at hf://dataset
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22 | الخطأ: Exception encountered at "In [9]": NameError                                 Traceback (most recent call last) NameError: name 'realistic_steps' is not defined
- (+4 دفتراً غير تابع لشام، +2 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-10-04T21:33 in_progress ، 2026-10-04T18:30 success ، 2026-10-04T18:01 success
- Sham CI (contract + self-tests, read-only): 2026-10-04T21:30 in_progress ، 2026-10-04T21:18 cancelled ، 2026-10-04T18:11 success
- Sham Collector (free CPU runner): 2026-10-04T21:20 in_progress
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-10-04T21:14 in_progress

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 2776586859 | 2026-10-04 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 144043947 | 2026-10-04 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 34975584 | 2026-10-04 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 768362 | 2026-10-01 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-multimodal-checkpoint | 577676682 | 2026-10-03 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 580621375 | 2026-10-03 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 2731054018 | 2026-10-04 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 385145782 | 2026-10-04 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 582297996 | 2026-10-03 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 16620339 | 2026-10-03 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | — | غير موجودة | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | — | غير موجودة | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-gh-collect-corpus | — | غير موجودة | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-merged-checkpoint | — | غير موجودة | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | — | غير موجودة | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | ❓ غير معرّف | (ليست في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | ❓ غير معرّف | (ليست في العقد) |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | ❓ غير معرّف | (ليست في العقد) |
| sham-orchestrator-state | 277 | 2026-09-27 | ❓ غير معرّف | (ليست في العقد) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |

## ما في المجموعات غير الموثّقة (بحسب نوع الملفات — تُدمج وفق نظامنا بحسب نوعها)
- sham-audio-tokenizer-adult-synth: 2 ملف (model 1، text 1) — مثال: audio_tokenizer.pt | audio_tokenizer_progress.json
- sham-video-frames-audio-tokenizers: 4 ملف (model 2، text 2) — مثال: audio_tokenizer.pt | audio_tokenizer_progress.json | image_tokenizer.pt
- sham-audio-tokenizer-adult-synth-v2: 2 ملف (model 1، text 1) — مثال: audio_tokenizer.pt | audio_tokenizer_progress.json
- sham-orchestrator-state: 1 ملف (text 1) — مثال: accelerator_state.json

## آخر تقارير الجلسات (الأحدث أولاً)
لا تقارير بعد.
