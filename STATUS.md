# حالة مشروع شام — 2026-10-07 06:07 UTC

> تُحدَّث تلقائياً كل 3 ساعات من GitHub Actions. الدفاتر بأسماء مستعارة عمداً (قرار المالكة)؛ الأسماء الحقيقية في تيليجرام المالكة فقط.

## التنبيهات (ابدأ منها)
- لا تنبيهات ✅

## المراحل
- ✅ المرحلة الأولى — تدريب النص الأساسي (GPU) — دفتر: running
- ✅ مسار ترميز الصورة (VQ-VAE) — دفتر: complete — تقدم: {'samples_consumed': 1684, 'step': 53, 'last_run_sources': {'x': 74, 'web_fallback': 9}}
- ✅ مسار ترميز الصوت (VQ-VAE) — دفتر: complete — تقدم: {'samples_consumed': 2508, 'step': 197, 'last_run_sources': {'x': 51}}
- ✅ مسار جمع وترميز الفيديو — دفتر: complete — تقدم: {'videos_consumed': 568}
- ✅ المرحلة الثانية — دمج الصورة والصوت مع النص (GPU) — دفتر: running
- ✅ المسار A — التدريب النصي المستمر (CPU) — دفتر: running
- ✅ المسار B — البحث الذاتي من الإنترنت (CPU) — دفتر: running
- ✅ المرحلة الثالثة — التجميع والمحادثة (كل الوسائط + البحث + الدمج) — دفتر: complete

**الخطوة التالية المقترحة:** شام متعدد الوسائط جاهز (نص + صورة + صوت). — الخطوة التالية: تشغيل خادم شام (serve.py) على النقطة final_multimodal.pt وربطه بالموقع/البوت. أخبري Claude: «لنكمل شام».

## الدفاتر على Kaggle (بأسماء مستعارة)
- complete | المدرّب الحي 1 | الدور: primary | آخر تشغيل 2026-10-03 | GPU
- complete | المرحلة الثالثة 4 | الدور: duplicate | آخر تشغيل 2026-10-02
- complete | المرحلة الثالثة 3 | الدور: duplicate | آخر تشغيل 2026-10-01
- complete | المرحلة الثالثة 2 | الدور: duplicate | آخر تشغيل 2026-09-30 | GPU
- complete | مركز تحكم شام 1 | الدور: tool | آخر تشغيل 2026-09-24
- complete | المرحلة الثالثة 5 | الدور: primary | آخر تشغيل 2026-10-03
- cancelAcknowledged | مسار ترميز الصورة 2 | الدور: duplicate | آخر تشغيل 2026-09-28
- error | مسار ترميز الصوت 2 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ: ---> 58             raise ConnectionError(      60         except HTTPError as e: ConnectionError: Connection error trying to communicate with service. قبل الفشل: 0.00s - to python to disable frozen m
- complete | المرحلة الثالثة 1 | الدور: duplicate | آخر تشغيل 2026-09-28
- complete | تجربة بوت شام 1 | الدور: tool | آخر تشغيل 2026-10-06
- running | المرحلة الثانية 2 | الدور: primary | آخر تشغيل 2026-10-07
- complete | مسار جمع وترميز الفيديو 1 | الدور: primary | آخر تشغيل 2026-10-01
- complete | مسار ترميز الصوت 3 | الدور: primary | آخر تشغيل 2026-10-06
- complete | مسار ترميز الصورة 3 | الدور: primary | آخر تشغيل 2026-10-06 | GPU
- running | المسار B 1 | الدور: primary | آخر تشغيل 2026-10-07
- running | المسار A 1 | الدور: primary | آخر تشغيل 2026-10-06
- running | المرحلة الأولى 2 | الدور: primary | آخر تشغيل 2026-10-07
- complete | المرحلة الثانية 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- complete | مسار ترميز الصورة 1 | الدور: duplicate | آخر تشغيل 2026-09-23
- error | مسار ترميز الصوت 1 | الدور: duplicate | آخر تشغيل 2026-09-23 | الخطأ:     494     except FileNotFoundError: --> 495         raise EmptyDatasetError(f"The directory at {base_path} doesn't contain any data files") from None EmptyDatasetError: The directory at hf://dataset
- error | المرحلة الأولى 1 | الدور: duplicate | آخر تشغيل 2026-09-22 | الخطأ: Exception encountered at "In [9]": NameError                                 Traceback (most recent call last) NameError: name 'realistic_steps' is not defined قبل الفشل: عدد ملفات الشحنات: 4 | أعيد ا
- (+4 دفتراً غير تابع لشام، +2 من دفاتر المهندس — مخفية)

## مصنع GitHub المجاني (آخر التشغيلات)
- Sham Status (supervision snapshot): 2026-10-07T06:06 in_progress ، 2026-10-06T22:40 success
- Sham Collector (free CPU runner): 2026-10-07T05:53 in_progress ، 2026-10-06T22:38 success
- Sham CPU Trainer (free CPU runner, slow and continuous): 2026-10-07T05:43 in_progress
- Sham Merge + Repair + Eval (free CPU runner): 2026-10-06T21:12 success

## آخر أخطاء مصنع GitHub (أين فشل بالضبط)
- لا أخطاء حديثة ✅

## المجموعات (ما كُتب أم لا، ومن يكتبها)
| المجموعة | الحجم | آخر تحديث | الكاتب المعلن | الدور |
|---|---|---|---|---|
| sham-checkpoint | 0 | 2026-10-06 | stage1_text | نقطة حفظ النص الأساسي (المرحلة الأولى) + مُرمِّز النص العام |
| nova-small-checkpoint | 2444237366 | 2026-09-19 | — | الاسم القديم لـ sham-checkpoint — يُقرأ احتياطاً فقط |
| sham-image-tokenizer-checkpoint | 144063660 | 2026-10-07 | image_tokenizer | مُرمِّز الصورة VQ-VAE |
| sham-audio-tokenizer-checkpoint | 35001140 | 2026-10-07 | audio_tokenizer | مُرمِّز الصوت VQ-VAE |
| sham-video-corpus | 768362 | 2026-10-01 | video_tokenizer | فيديو مُجمَّع ومُرمَّز |
| sham-multimodal-checkpoint | 577937033 | 2026-10-06 | stage2_multimodal | نقطة حفظ المرحلة الثانية (نص + صورة + صوت) |
| sham-chat-checkpoint | 580621375 | 2026-10-03 | chat_stage | نقطة حفظ مرحلة المحادثة والدمج (الخط الرئيسي للنموذج) |
| sham-cpu-track-checkpoint | 175 | 2026-09-20 | — | قديم (v1) — لا يُكتب |
| sham-cpu-track-checkpoint-v2 | 0 | 2026-10-06 | track_a | المسار A: تدريب نصي مستمر على CPU |
| sham-research-track-checkpoint-v2 | 385702205 | 2026-10-06 | track_b | المسار B: بحث ذاتي من الإنترنت + تدريب CPU |
| sham-crawl-checkpoint | 582297996 | 2026-10-03 | live_trainer | المدرّب الحي على Kaggle (نموذج) |
| sham-crawl-corpus | 16620339 | 2026-10-03 | live_trainer | نصوص المدرّب الحي على Kaggle |
| sham-crawl-legacy | — | غير موجودة | repair | ما نشره زاحف المهندس الأول داخل مجموعة المرحلة الثانية (يُنقل بالإصلاح) |
| sham-chat-checkpoint-incoming | — | غير موجودة | repair | ما نُشر فوق مجموعة المحادثة من دفتر آخر (يُنقل بالإصلاح) |
| sham-crawl-gh | 581744197 | 2026-10-06 | gh_cpu_trainer | مدرّب CPU على GitHub (نموذج) |
| sham-crawl-gh-corpus | 2454959 | 2026-10-06 | gh_cpu_trainer | نصوص مدرّب CPU على GitHub |
| sham-crawl-gh-collect-corpus | 369589185 | 2026-10-07 | gh_collector | الزاحف العام على GitHub (نصوص فقط) |
| sham-merged-checkpoint | 579974646 | 2026-10-06 | gh_merge_eval | ناتج الدمج والإصلاح على CPU (يُدمج في مرحلة المحادثة كمصدر) |
| sham-reports | 2219 | 2026-10-07 | any (عبر sham_reports.py من كل دفتر) | نسخة من تقارير الجلسات (للإشراف) |
| sham-research-track-checkpoint | — | غير موجودة | — | الاسم القديم (v1) للمسار B — يُقرأ احتياطاً فقط |
| sham-checkpoint-v2 | — | غير موجودة | — | اسم بديل يقترحه الدفتر الأول عند تعارض اسم المجموعة — ليس مجموعة قائمة |
| sham-audio-tokenizer-adult-synth | 34872718 | 2026-09-24 | — | مُرمِّز صوت (VQ) تجربة قديمة — مرشّح صوتي، تُدمج أوزانه بحسب نوعها (صوت) حين تتوافق البنية، وإلا يبقى مرشّحاً |
| sham-audio-tokenizer-adult-synth-v2 | 34872673 | 2026-09-21 | — | مُرمِّز صوت (VQ) النسخة الثانية للتجربة — مرشّح صوتي (صوت) |
| sham-video-frames-audio-tokenizers | 178421614 | 2026-09-23 | — | مُرمِّزا صورة وصوت من مسار الفيديو — مرشّحان لمساري الصورة والصوت بحسب نوع كل ملف |
| sham-orchestrator-state | 277 | 2026-09-27 | — | حالة المُنسِّق (accelerator_state.json) — ملف حالة نصي صغير، لا أوزان فيه فلا يدخل الدمج |
| sham-crawl-xlive | 1373973598 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent | 1370230289 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-agent-corpus | 65727 | 2026-10-01 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |
| sham-crawl-xlive-corpus | 251624 | 2026-10-03 | زاحف مكتشف تلقائياً | (نمط ديناميكي في العقد) |

## آخر تقارير الجلسات (الأحدث أولاً)
### 2026-10-07 03:49 UTC — 🕸 الزاحف العام (GitHub): 91,642 وثيقة، 143.1 مليون حرف في 5.2 ساعة | hackernews:
```
🕸 الزاحف العام (GitHub): 91,642 وثيقة، 143.1 مليون حرف في 5.2 ساعة | hackernews:38246 crossref:38139 arxiv:7022 gutenberg:4283 github:2776 ia_books:637 stackexchange:537 europepmc:2 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
### 2026-10-06 23:57 UTC — 🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
```
🧠 تقرير جلسة شام — التدريب المستمر على المعالج المركزي (Track A)
خطوات تدريب حقيقية هذه الجلسة: 563 (الخطوة النهائية: 41,041)
متوسط الخسارة أول 10 خطوات: 4.4562
متوسط الخسارة آخر 10 خطوات: 4.6996
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 4.539 → بعد 4.601 (+0.062)
خسارة التدريب في آخر 50 خطوة: 4.776
نُشر إلى: jonsnowjonsnow/sham-cpu-track-checkpoint-v2
```
### 2026-10-06 23:46 UTC — 🧠 تقرير جلسة شام — المسار الرئيسي (GPU)
```
🧠 تقرير جلسة شام — المسار الرئيسي (GPU)
خطوات تدريب حقيقية هذه الجلسة: 5600 (الخطوة النهائية: 61,035)
متوسط الخسارة أول 10 خطوات: 3.9790
متوسط الخسارة آخر 10 خطوات: 2.7743
(كل رقم منهما دفعة واحدة، يتأرجح بنحو ±1.5 وحده — الحَكَم هو القياس على نص لم يُدرَّب عليه أدناه)
📏 على نص لم يُدرَّب عليه: قبل 2.516 → بعد 1.540 (-0.976)
خسارة التدريب في آخر 50 خطوة: 2.436
🌊 خط النص المتدفق: 90,533 نافذة جديدة (كل نافذة مرة واحدة) من 22 مصدراً | انتظار التدريب للبيانات 21638ث
نُشر إلى: jonsnowjonsnow/sham-checkpoint
```
### 2026-10-06 23:13 UTC — 🤖 مدرّب CPU على GitHub: 2,428 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: 
```
🤖 مدرّب CPU على GitHub: 2,428 خطوة | نُشر: jonsnowjonsnow/sham-crawl-gh | نصوص: jonsnowjonsnow/sham-crawl-gh-corpus | مؤشر الحارس 0.972
```
### 2026-10-06 21:34 UTC — 🧩 الدمج والتقييم على CPU (GitHub)
```
🧩 الدمج والتقييم على CPU (GitHub)
الأساس: sham-merged-checkpoint (يكمل من ناتجه السابق) (خطوة 45,584)
قبل: text=7.679, chat=5.895, media=8.565
بعد: text=5.924, chat=5.271, media=8.566
⏭ sham-multimodal-checkpoint: الخطوة 38,785 جُرّبت سابقاً
⏭ sham-checkpoint: الخطوة 55,400 جُرّبت سابقاً
⏭ sham-crawl-checkpoint: الخطوة 59,089 جُرّبت سابقاً
⏭ sham-crawl-agent: الخطوة 42,893 جُرّبت سابقاً
⏭ sham-crawl-xlive: الخطوة 51,425 جُرّبت سابقاً
⏭ sham-cpu-track-checkpoint: لا توجد نقطة حفظ
⏭ sham-orchestrator-state: لا توجد نقطة حفظ
قبل الدمج: text=7.679, chat=5.895, media=8.565
✅ sham-cpu-track-checkpoint-v2 (خطوة 40,478): دُمج بنسبة 0.50 — text=5.924, chat=5.271, media=8.566
❌ sham-research-track-checkpoint-v2 (خطوة 51,115): لم يُدمج (لم يحسّن كل المهارات معاً)
❌ sham-crawl-gh (خطوة 51,947): لم يُدمج (لم يحسّن كل المهارات معاً)
نُشر إلى jonsnowjonsnow/sham-merged-checkpoint
(12 دقيقة)
```
### 2026-10-06 18:31 UTC — 🕸 الزاحف العام (GitHub): 90,820 وثيقة، 144.8 مليون حرف في 5.2 ساعة | hackernews:
```
🕸 الزاحف العام (GitHub): 90,820 وثيقة، 144.8 مليون حرف في 5.2 ساعة | hackernews:38680 crossref:26407 arxiv:16558 gutenberg:4367 github:3191 ia_books:1245 stackexchange:354 europepmc:18 | نُشر إلى jonsnowjonsnow/sham-crawl-gh-collect-corpus
```
